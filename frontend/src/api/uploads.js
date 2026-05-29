import { http } from './http'
import { pdfjs } from '../lib/pdfjs'

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
  pdf: 'application/pdf',
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

// Public helper for previewing a video before upload — returns an object URL of
// a single frame. Caller is responsible for revoking the URL when done.
export async function extractVideoPosterUrl(file) {
  const { video, url } = await loadVideo(file)
  try {
    const { file: posterFile } = await captureVideoPoster(video)
    return URL.createObjectURL(posterFile)
  } finally {
    URL.revokeObjectURL(url)
  }
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

// Decode + sample an audio file and render a waveform thumbnail with the
// duration overlaid. Returns { file, width, height, duration } so the caller
// can both upload the thumb and pick up the duration without a second pass.
async function generateAudioWaveformThumb(file) {
  const arrayBuffer = await file.arrayBuffer()
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('AudioContext unavailable')
  const ctx = new Ctx()
  let audioBuffer
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    ctx.close()
  }

  const duration = audioBuffer.duration
  const channel = audioBuffer.getChannelData(0)

  const BARS = 80
  const samplesPerBar = Math.max(1, Math.floor(channel.length / BARS))
  const peaks = new Array(BARS)
  let globalMax = 0
  for (let i = 0; i < BARS; i++) {
    const start = i * samplesPerBar
    const end = Math.min(start + samplesPerBar, channel.length)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j])
      if (v > max) max = v
    }
    peaks[i] = max
    if (max > globalMax) globalMax = max
  }

  const size = 400
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const c = canvas.getContext('2d')

  // Cream background to match the Hearth palette.
  c.fillStyle = '#f1ece2'
  c.fillRect(0, 0, size, size)

  // Waveform bars in the accent slate.
  const slot = size / BARS
  const barW = slot * 0.6
  const midY = size / 2
  const maxBarH = size * 0.55
  c.fillStyle = '#5a7390'
  for (let i = 0; i < BARS; i++) {
    const norm = globalMax > 0 ? peaks[i] / globalMax : 0
    const h = Math.max(2, norm * maxBarH)
    const x = i * slot + (slot - barW) / 2
    c.fillRect(x, midY - h / 2, barW, h)
  }

  // Duration text along the bottom in dark ink.
  const mins = Math.floor(duration / 60)
  const secs = Math.floor(duration % 60)
  const durText = `${mins}:${String(secs).padStart(2, '0')}`
  c.fillStyle = '#1f2a35'
  c.font = '600 44px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'alphabetic'
  c.fillText(durText, size / 2, size - 36)

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Waveform encoding failed'))),
      'image/jpeg',
      0.85,
    )
  })

  return {
    file: new File([blob], 'waveform.jpg', { type: 'image/jpeg' }),
    width: size,
    height: size,
    duration: Number.isFinite(duration) ? duration : null,
  }
}

// Preview helper for the EventForm queue — same rendering, returns just an
// object URL. Caller revokes when done.
export async function extractAudioWaveformUrl(file) {
  const { file: thumbFile } = await generateAudioWaveformThumb(file)
  return URL.createObjectURL(thumbFile)
}

async function uploadAudio(file) {
  // Try the waveform path first — gets duration AND a visual thumb in one pass.
  let thumb = null
  try {
    thumb = await generateAudioWaveformThumb(file)
  } catch {
    // Decode can fail (DRM, unsupported codec). Fall back to <audio> metadata.
  }

  let duration = thumb?.duration ?? null
  if (duration === null) {
    const url = URL.createObjectURL(file)
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
  }

  // Upload the original file, plus the waveform thumb if we got one.
  const fullPromise = putToR2({ file, width: null, height: null })
  let thumbMeta = null
  if (thumb) {
    try {
      thumbMeta = await putToR2({ file: thumb.file, width: thumb.width, height: thumb.height })
    } catch {
      // Best-effort — audio still attaches without the thumb.
    }
  }
  const fullMeta = await fullPromise

  return {
    kind: 'audio',
    key: fullMeta.key,
    thumb_key: thumbMeta?.key || null,
    content_type: fullMeta.content_type,
    duration_seconds: duration,
  }
}

// Render page 1 of a PDF File to a JPEG thumbnail at THUMB_MAX_DIM longest edge.
// Returns { file, width, height, pageCount } so the caller can both upload the
// thumb and pick up the page count for the media metadata.
async function generatePdfPageOneThumb(file) {
  const arrayBuffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
  try {
    const pageCount = doc.numPages
    const page = await doc.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const longest = Math.max(baseViewport.width, baseViewport.height)
    const scale = longest > 0 ? THUMB_MAX_DIM / longest : 1
    const viewport = page.getViewport({ scale })
    const width = Math.round(viewport.width)
    const height = Math.round(viewport.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PDF thumb encoding failed'))),
        'image/jpeg',
        THUMB_QUALITY,
      )
    })
    return {
      file: new File([blob], 'pdf-page-1.jpg', { type: 'image/jpeg' }),
      width,
      height,
      pageCount,
    }
  } finally {
    doc.destroy?.()
  }
}

// Preview helper for the EventForm queue — returns an object URL of the page-1
// thumb. Caller revokes when done.
export async function extractPdfPosterUrl(file) {
  const { file: thumbFile } = await generatePdfPageOneThumb(file)
  return URL.createObjectURL(thumbFile)
}

async function uploadPdf(file) {
  // Render page-1 thumb first; we want pageCount + a poster regardless of
  // upload order. If rendering fails (encrypted PDF, etc.) we still attach
  // the original without a thumb.
  let thumb = null
  try {
    thumb = await generatePdfPageOneThumb(file)
  } catch {
    // Best-effort — PDF still attaches without poster.
  }
  const fullPromise = putToR2({ file, width: null, height: null })
  let thumbMeta = null
  if (thumb) {
    try {
      thumbMeta = await putToR2({ file: thumb.file, width: thumb.width, height: thumb.height })
    } catch {
      // Best-effort.
    }
  }
  const fullMeta = await fullPromise
  return {
    kind: 'pdf',
    key: fullMeta.key,
    thumb_key: thumbMeta?.key || null,
    content_type: fullMeta.content_type,
    width: thumb?.width || null,
    height: thumb?.height || null,
    page_count: thumb?.pageCount ?? null,
  }
}

// Routes a File to the right upload pipeline based on its MIME type
// (with extension fallback for files the browser tags weirdly, e.g. m4a).
export async function uploadMedia(file) {
  const type = normalizedContentType(file)
  if (type.startsWith('image/')) return uploadPhoto(file)
  if (type.startsWith('video/')) return uploadVideo(file)
  if (type.startsWith('audio/')) return uploadAudio(file)
  if (type === 'application/pdf') return uploadPdf(file)
  throw new Error(`Unsupported media type: ${type || 'unknown'}`)
}
