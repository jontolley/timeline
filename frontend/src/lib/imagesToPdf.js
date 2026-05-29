import { FULL_MAX_DIM, FULL_QUALITY, loadImage, renderResized } from '../api/uploads'
import { scanDocument } from './documentScan'

// HEIC/HEIF aren't decodable via <img> outside Safari, so we route them
// through heic2any (lazy-loaded — it's large and only needed for Apple photos).
export function isHeic(file) {
  const type = (file.type || '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return ext === 'heic' || ext === 'heif'
}

// Decode an image File to resized JPEG bytes suitable for embedding in a PDF.
// HEIC is converted to JPEG first so it works in every browser; everything
// else goes straight through the canvas resize used by the photo upload path.
// When documentScan is set, each image is run through page detection +
// perspective correction first, falling back to the original on failure.
async function decodeToJpeg(file, documentScan) {
  let source = file
  if (isHeic(file)) {
    const { default: heic2any } = await import('heic2any')
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    const out = Array.isArray(blob) ? blob[0] : blob
    source = new File([out], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' })
  }
  const { img, url } = await loadImage(source)
  try {
    // renderResized works with any drawable (img or canvas), so the deskewed
    // scan canvas drops straight in when detection succeeds.
    let drawable = img
    if (documentScan) {
      try {
        const scanned = await scanDocument(img)
        if (scanned) drawable = scanned
      } catch { /* keep the original image */ }
    }
    const baseName = source.name.replace(/\.\w+$/, '')
    const { file: jpeg, width, height } = await renderResized(
      drawable,
      FULL_MAX_DIM,
      FULL_QUALITY,
      `${baseName}.jpg`,
    )
    const bytes = new Uint8Array(await jpeg.arrayBuffer())
    return { bytes, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Combine an ordered list of image Files into a single PDF File — one image
// per page, the page sized to the (resized) image so there's no letterboxing.
// Reuses the existing canvas resize/orientation handling, so the result drops
// straight into the existing `uploadPdf` media pipeline.
//
// The filename is never shown to the user (R2 generates its own key), so it
// defaults to a GUID. onProgress(done, total) fires after each image is placed.
export async function imagesToPdf(files, { name, onProgress, documentScan = false } = {}) {
  if (!files.length) throw new Error('No images selected')
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()

  for (let i = 0; i < files.length; i++) {
    const { bytes, width, height } = await decodeToJpeg(files[i], documentScan)
    const embedded = await doc.embedJpg(bytes)
    const page = doc.addPage([width, height])
    page.drawImage(embedded, { x: 0, y: 0, width, height })
    onProgress?.(i + 1, files.length)
  }

  const pdfBytes = await doc.save()
  const safeName = (name?.trim() || crypto.randomUUID()).replace(/\.pdf$/i, '')
  return new File([pdfBytes], `${safeName}.pdf`, { type: 'application/pdf' })
}
