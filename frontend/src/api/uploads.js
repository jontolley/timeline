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

async function presignUpload(contentType) {
  const res = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType }),
  })
  if (!res.ok) throw new Error('Failed to get upload URL')
  return res.json()
}

async function putToR2({ file, width, height }) {
  const { upload_url, key } = await presignUpload(file.type)
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`)
  return { key, content_type: file.type, width, height }
}

// End-to-end: render full + thumb → presign each → PUT each to R2.
// Returns photo metadata (with thumb_key) to attach to the event.
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
