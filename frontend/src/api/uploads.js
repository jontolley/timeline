import { http } from './http'

const FULL_MAX_DIM = 2000
const THUMB_MAX_DIM = 400
const FULL_QUALITY = 0.85
const THUMB_QUALITY = 0.8

// Load a File into an HTMLImageElement. Modern browsers auto-apply EXIF
// orientation when drawing to canvas, so no manual rotation handling needed.
async function loadImage(file) {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ img, url })
      img.onerror = () => reject(new Error('Could not load image'))
      img.src = url
    })
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

function renderResized(img, maxDim, quality, filename) {
  const longest = Math.max(img.width, img.height)
  const scale = longest > maxDim ? maxDim / longest : 1
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(img, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('Encoding failed'))
        const file = new File([b], filename, { type: 'image/jpeg' })
        resolve({ file, width, height })
      },
      'image/jpeg',
      quality,
    )
  })
}

export async function extractExif(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await http('/api/uploads/extract-exif', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Could not read photo metadata')
  return res.json()
}

export async function describePhoto(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await http('/api/uploads/describe-photo', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Could not generate caption')
  return res.json()
}

async function presignUpload(contentType) {
  const res = await http('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType }),
  })
  if (!res.ok) throw new Error('Failed to get upload URL')
  return res.json()
}

// Browsers report inconsistent MIME types for some files (e.g. .m4a often
// comes through as audio/x-m4a or empty). Normalize from the extension so
// the backend allowlist accepts what we send.
const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}
const ALLOWED_MIMES = new Set(Object.values(EXT_TO_MIME))

function normalizedContentType(file) {
  if (file.type && ALLOWED_MIMES.has(file.type)) return file.type
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext]
  return file.type || 'application/octet-stream'
}

async function putToR2({ file, width, height }) {
  const contentType = normalizedContentType(file)
  const { upload_url, key } = await presignUpload(contentType)
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  })
  if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`)
  return { key, content_type: contentType, width, height }
}

// End-to-end photo upload: render full + thumb → presign each → PUT each to R2.
// Returns media metadata (with thumb_key + kind:"photo") ready for attachMedia.
export async function uploadPhoto(file) {
  const baseName = file.name.replace(/\.\w+$/, '')
  const { img, url } = await loadImage(file)
  try {
    const [full, thumb] = await Promise.all([
      renderResized(img, FULL_MAX_DIM, FULL_QUALITY, `${baseName}.jpg`),
      renderResized(img, THUMB_MAX_DIM, THUMB_QUALITY, `${baseName}-thumb.jpg`),
    ])
    const [fullMeta, thumbMeta] = await Promise.all([
      putToR2(full),
      putToR2(thumb),
    ])
    return {
      kind: 'photo',
      key: fullMeta.key,
      thumb_key: thumbMeta.key,
      content_type: fullMeta.content_type,
      width: fullMeta.width,
      height: fullMeta.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Load a File into a hidden <video> element so we can read duration + render a frame.
async function loadVideo(file) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = url
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve
    video.onerror = () => reject(new Error('Could not load video'))
  })
  return { video, url }
}

// Capture a single frame from the video at ~1s in (or end if shorter).
async function captureVideoPoster(video) {
  const target = Math.min(1.0, Math.max(0, (video.duration || 0) * 0.1))
  await new Promise((resolve) => {
    const handler = () => { video.removeEventListener('seeked', handler); resolve() }
    video.addEventListener('seeked', handler)
    try { video.currentTime = target } catch { resolve() }
  })
  const longest = Math.max(video.videoWidth, video.videoHeight)
  const scale = longest > FULL_MAX_DIM ? FULL_MAX_DIM / longest : 1
  const width = Math.round(video.videoWidth * scale)
  const height = Math.round(video.videoHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(video, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('Poster encoding failed'))
        resolve({
          file: new File([b], 'poster.jpg', { type: 'image/jpeg' }),
          width,
          height,
        })
      },
      'image/jpeg',
      0.82,
    )
  })
}

async function uploadVideo(file) {
  const { video, url } = await loadVideo(file)
  try {
    // Run the original-file upload and poster capture in parallel.
    const fullPromise = putToR2({ file, width: video.videoWidth, height: video.videoHeight })
    let posterMeta = null
    try {
      const poster = await captureVideoPoster(video)
      posterMeta = await putToR2(poster)
    } catch {
      // Poster is best-effort; the video still attaches without one.
    }
    const fullMeta = await fullPromise
    return {
      kind: 'video',
      key: fullMeta.key,
      thumb_key: posterMeta?.key || null,
      content_type: fullMeta.content_type,
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      duration_seconds: Number.isFinite(video.duration) ? video.duration : null,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function uploadAudio(file) {
  // Read duration via a transient <audio> so the saved metadata is useful.
  const url = URL.createObjectURL(file)
  let duration = null
  try {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = url
    await new Promise((resolve) => {
      audio.onloadedmetadata = resolve
      audio.onerror = resolve
    })
    if (Number.isFinite(audio.duration)) duration = audio.duration
  } finally {
    URL.revokeObjectURL(url)
  }
  const meta = await putToR2({ file, width: null, height: null })
  return {
    kind: 'audio',
    key: meta.key,
    thumb_key: null,
    content_type: meta.content_type,
    duration_seconds: duration,
  }
}

// Routes a File to the right upload pipeline based on its MIME type
// (with extension fallback for files the browser tags weirdly, e.g. m4a).
export async function uploadMedia(file) {
  const type = normalizedContentType(file)
  if (type.startsWith('image/')) return uploadPhoto(file)
  if (type.startsWith('video/')) return uploadVideo(file)
  if (type.startsWith('audio/')) return uploadAudio(file)
  throw new Error(`Unsupported media type: ${type || 'unknown'}`)
}
