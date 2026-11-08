import { File, UploadType } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { getThumbnailAsync } from 'expo-video-thumbnails'
import { httpJson, getAuthToken } from './client'
import { API } from '../config'
import type { MediaRef } from './types'
import { pdfInfo, type DocumentFile } from '../../modules/hindsite-documents'

// Native port of frontend/src/api/uploads.js. The web pipeline used an HTML
// canvas to resize photos and render video/audio/pdf thumbnails; on native we
// use expo-image-manipulator for photo resizing and expo-file-system's
// File.upload for the direct-to-R2 PUT (a native upload task — more robust
// than fetch(blob) for large files).
//
// Photo upload has full parity (full + thumb). Videos upload the original
// plus a first-frame poster (expo-video-thumbnails) as the thumb. PDFs upload
// as-is with a page-1 render (PDFKit, modules/hindsite-documents) as the thumb
// plus their page count. Audio still uploads without a thumbnail (a native
// waveform render is a phase-2 task; see mobile/README.md) — the backend
// stores it fine without a thumb_key.

export const FULL_MAX_DIM = 2000
const THUMB_MAX_DIM = 400
export const FULL_QUALITY = 0.85
const THUMB_QUALITY = 0.8

export type PickedAsset = {
  uri: string
  width?: number
  height?: number
  mimeType?: string
  fileName?: string | null
  // A PDF built on the phone (scan / combined photos) already knows its page
  // count and page-1 thumb; a picked or shared PDF is read on upload.
  document?: DocumentFile
}

async function presignUpload(contentType: string): Promise<{ upload_url: string; key: string }> {
  return httpJson('/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType }),
  })
}

// Direct-to-R2 PUT via a presigned URL. Bypasses our backend/nginx entirely,
// and (being a native request) is not subject to R2's browser CORS allowlist.
async function putToR2(uri: string, contentType: string): Promise<string> {
  const { upload_url, key } = await presignUpload(contentType)
  const res = await new File(uri).upload(upload_url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': contentType },
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Upload failed: ${res.status}`)
  }
  return key
}

// Resize the longest edge down to maxDim (preserving aspect ratio; never
// upscales) and save as JPEG. Falls back to a width cap when the picker didn't
// report dimensions.
async function renderJpeg(
  uri: string,
  width: number,
  height: number,
  maxDim: number,
  compress: number,
) {
  const ctx = ImageManipulator.manipulate(uri)
  const longest = Math.max(width, height)
  if (longest === 0) ctx.resize({ width: maxDim })
  else if (longest > maxDim) ctx.resize(width >= height ? { width: maxDim } : { height: maxDim })
  const image = await ctx.renderAsync()
  return image.saveAsync({ format: SaveFormat.JPEG, compress })
}

export async function uploadPhoto(asset: PickedAsset): Promise<MediaRef> {
  const w = asset.width ?? 0
  const h = asset.height ?? 0
  const [full, thumb] = await Promise.all([
    renderJpeg(asset.uri, w, h, FULL_MAX_DIM, FULL_QUALITY),
    renderJpeg(asset.uri, w, h, THUMB_MAX_DIM, THUMB_QUALITY),
  ])
  const [fullKey, thumbKey] = await Promise.all([
    putToR2(full.uri, 'image/jpeg'),
    putToR2(thumb.uri, 'image/jpeg'),
  ])
  return {
    kind: 'photo',
    key: fullKey,
    thumb_key: thumbKey,
    content_type: 'image/jpeg',
    width: full.width,
    height: full.height,
  }
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

function contentTypeFor(asset: PickedAsset): string {
  if (asset.mimeType) return asset.mimeType
  const ext = (asset.fileName || asset.uri).split('.').pop()?.toLowerCase() || ''
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

export function isVideoAsset(asset: PickedAsset): boolean {
  return contentTypeFor(asset).startsWith('video/')
}

export function isPdfAsset(asset: PickedAsset): boolean {
  return contentTypeFor(asset) === 'application/pdf'
}

function kindFor(contentType: string): MediaRef['kind'] {
  if (contentType.startsWith('image/')) return 'photo'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'pdf'
}

// First frame of a local video as a JPEG (full video resolution). Used for the
// form's pending tile and, resized, as the uploaded poster.
export function videoPoster(uri: string) {
  return getThumbnailAsync(uri, { time: 0, quality: 0.9 })
}

async function uploadVideo(asset: PickedAsset): Promise<MediaRef> {
  const contentType = contentTypeFor(asset)
  // Poster is best-effort; the video still attaches without one.
  const posterPromise = videoPoster(asset.uri)
    .then(async (frame) => {
      const thumb = await renderJpeg(frame.uri, frame.width, frame.height, THUMB_MAX_DIM, THUMB_QUALITY)
      return { key: await putToR2(thumb.uri, 'image/jpeg'), width: frame.width, height: frame.height }
    })
    .catch(() => null)
  const [key, poster] = await Promise.all([putToR2(asset.uri, contentType), posterPromise])
  return {
    kind: 'video',
    key,
    thumb_key: poster?.key ?? null,
    content_type: contentType,
    width: poster?.width,
    height: poster?.height,
  }
}

// The PDF as-is, plus its page-1 render as the thumb (best-effort: a PDF
// that can't be read still attaches, with the plain document tile).
async function uploadPdf(asset: PickedAsset): Promise<MediaRef> {
  const info = asset.document ?? (await pdfInfo(asset.uri).catch(() => null))
  const thumbPromise = info?.thumbUri
    ? putToR2(info.thumbUri, 'image/jpeg').catch(() => null)
    : Promise.resolve(null)
  const [key, thumbKey] = await Promise.all([putToR2(asset.uri, 'application/pdf'), thumbPromise])
  return {
    kind: 'pdf',
    key,
    thumb_key: thumbKey,
    content_type: 'application/pdf',
    width: thumbKey ? info?.thumbWidth : undefined,
    height: thumbKey ? info?.thumbHeight : undefined,
    page_count: info?.pageCount ?? null,
  }
}

// Upload a non-photo file as-is (no client thumbnail). See module note.
async function uploadFile(asset: PickedAsset): Promise<MediaRef> {
  const contentType = contentTypeFor(asset)
  const key = await putToR2(asset.uri, contentType)
  return {
    kind: kindFor(contentType),
    key,
    thumb_key: null,
    content_type: contentType,
  }
}

export async function uploadMedia(asset: PickedAsset): Promise<MediaRef> {
  const contentType = contentTypeFor(asset)
  if (contentType.startsWith('image/')) return uploadPhoto(asset)
  if (contentType.startsWith('video/')) return uploadVideo(asset)
  if (contentType === 'application/pdf') return uploadPdf(asset)
  return uploadFile(asset)
}

// Multipart POST to a backend endpoint that takes a `file` field. Used for the
// EXIF + caption helpers, which run server-side (no native canvas needed).
async function postFile<T>(path: string, asset: PickedAsset): Promise<T> {
  const token = getAuthToken()
  const res = await new File(asset.uri).upload(`${API}${path}`, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: contentTypeFor(asset),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return JSON.parse(res.body) as T
}

export type ExifResult = { date?: string; time?: string; lat?: number; lng?: number }
export function extractExif(asset: PickedAsset): Promise<ExifResult> {
  return postFile<ExifResult>('/uploads/extract-exif', asset)
}

export type CaptionResult = { title?: string; description?: string }
export function describePhoto(asset: PickedAsset): Promise<CaptionResult> {
  return postFile<CaptionResult>('/uploads/describe-photo', asset)
}
