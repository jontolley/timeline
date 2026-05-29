// Phase 1 document-scan spike: detect a page in a photo and return a
// deskewed/cropped canvas. The heavy lifting (OpenCV.js, ~10MB WASM) runs in a
// Web Worker (documentScan.worker.js) so it never freezes the UI thread — this
// module just shuttles pixels to and from it.
//
// Auto-detect only — no manual corner adjustment. When detection fails or
// looks implausible the worker replies "not ok" and we return null, so the
// caller keeps the original image.

// Detection doesn't need full camera resolution and the warp output feeds the
// 2000px PDF resize anyway, so cap the pixels we hand the worker.
const MAX_SCAN_DIM = 2000

let worker = null
let seq = 0

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./documentScan.worker.js', import.meta.url), { type: 'module' })
  }
  return worker
}

// Begin loading OpenCV in the worker ahead of time (e.g. when the checkbox is
// ticked) so the first page isn't blocked on a cold ~10MB fetch.
export function warmUpDocumentScan() {
  try {
    getWorker().postMessage({ type: 'warmup' })
  } catch { /* worker unsupported — scanning will no-op later */ }
}

// Draw an <img>/<canvas> to a (possibly downscaled) RGBA ImageData.
function toImageData(source) {
  const sw = source.naturalWidth || source.width
  const sh = source.naturalHeight || source.height
  const longest = Math.max(sw, sh)
  const scale = longest > MAX_SCAN_DIM ? MAX_SCAN_DIM / longest : 1
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Detect a document in an <img>/<canvas> and return a deskewed, perspective-
 * corrected HTMLCanvasElement, or null when no plausible page is found.
 */
export function scanDocument(source) {
  let imageData
  try {
    imageData = toImageData(source)
  } catch {
    return Promise.resolve(null)
  }

  const w = getWorker()
  const id = ++seq
  return new Promise((resolve) => {
    const onMessage = (e) => {
      if (e.data?.id !== id) return
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      if (!e.data.ok) { resolve(null); return }
      const out = new ImageData(new Uint8ClampedArray(e.data.buffer), e.data.width, e.data.height)
      const canvas = document.createElement('canvas')
      canvas.width = out.width
      canvas.height = out.height
      canvas.getContext('2d').putImageData(out, 0, 0)
      resolve(canvas)
    }
    const onError = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      resolve(null)
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    // Transfer the pixel buffer so we don't copy it across the thread boundary.
    w.postMessage({ id, type: 'scan', imageData }, [imageData.data.buffer])
  })
}
