import { File, UploadType } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { httpJson, getAuthToken } from './client'
import { API } from '../config'
import type { MediaRef } from './types'

// Native port of frontend/src/api/uploads.js. The web pipeline used an HTML
// canvas to resize photos and render video/audio/pdf thumbnails; on native we
// use expo-image-manipulator for photo resizing and expo-file-system's
// File.upload for the direct-to-R2 PUT (a native upload task — more robust
// than fetch(blob) for large files).
//
// Photo upload has full parity (full + thumb). Video/audio/pdf currently
// upload the original without a client-rendered thumbnail — generating those
// natively (AVAssetImageGenerator / PDFKit / waveform) is a phase-2 task; see
// mobile/README.md. The backend stores them fine without a thumb_key.

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

function kindFor(contentType: string): MediaRef['kind'] {
  if (contentType.startsWith('image/')) return 'photo'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'pdf'
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
