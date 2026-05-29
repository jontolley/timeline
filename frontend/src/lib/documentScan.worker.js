// OpenCV.js runs here, off the main thread, so document detection never
// freezes the UI. The main thread sends RGBA ImageData in and gets the
// deskewed page's RGBA pixels back (or a "no document" reply).
//
// Contour/corner/warp routines adapted from jscanify (MIT, © ColonelParrot —
// https://github.com/puffinsoft/jscanify). Workers have no DOM, so we use
// matFromImageData instead of cv.imread and return raw pixels instead of a
// canvas.
import cv from '@techstark/opencv-js'

let readyPromise = null
function whenReady() {
  if (readyPromise) return readyPromise
  readyPromise = typeof cv.Mat === 'function'
    ? Promise.resolve()
    : new Promise((resolve) => { cv.onRuntimeInitialized = () => resolve() })
  return readyPromise
}

function findPaperContour(img) {
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const thresh = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    cv.Canny(img, gray, 50, 200)
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
    cv.threshold(blur, thresh, 0, 255, cv.THRESH_OTSU)
    cv.findContours(thresh, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE)
    let maxArea = 0
    let maxIndex = -1
    for (let i = 0; i < contours.size(); i++) {
      const area = cv.contourArea(contours.get(i))
      if (area > maxArea) { maxArea = area; maxIndex = i }
    }
    return maxIndex >= 0 ? contours.get(maxIndex) : null
  } finally {
    gray.delete()
    blur.delete()
    thresh.delete()
    contours.delete()
    hierarchy.delete()
  }
}

function getCornerPoints(contour) {
  const rect = cv.minAreaRect(contour)
  const center = rect.center
  let tl, tr, bl, br
  let tlD = 0, trD = 0, blD = 0, brD = 0
  const data = contour.data32S
  for (let i = 0; i < data.length; i += 2) {
    const p = { x: data[i], y: data[i + 1] }
    const d = Math.hypot(p.x - center.x, p.y - center.y)
    if (p.x < center.x && p.y < center.y) { if (d > tlD) { tl = p; tlD = d } }
    else if (p.x > center.x && p.y < center.y) { if (d > trD) { tr = p; trD = d } }
    else if (p.x < center.x && p.y > center.y) { if (d > blD) { bl = p; blD = d } }
    else if (p.x > center.x && p.y > center.y) { if (d > brD) { br = p; brD = d } }
  }
  return { tl, tr, bl, br }
}

// Perspective-warp the RGBA mat to w×h and return a copied RGBA buffer.
function warp(img, corners, w, h) {
  const { tl, tr, bl, br } = corners
  const warped = new cv.Mat()
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, 0, h, w, h])
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  try {
    cv.warpPerspective(img, warped, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar())
    // matFromImageData yields CV_8UC4, so warped stays RGBA — copy it out.
    return new Uint8ClampedArray(warped.data)
  } finally {
    srcTri.delete()
    dstTri.delete()
    M.delete()
    warped.delete()
  }
}

self.onmessage = async (e) => {
  const { id, type, imageData } = e.data || {}
  if (type === 'warmup') { whenReady().catch(() => {}); return }
  if (type !== 'scan') return

  try {
    await whenReady()
    const mat = cv.matFromImageData(imageData)
    let contour = null
    try {
      contour = findPaperContour(mat)
      if (!contour) { self.postMessage({ id, ok: false }); return }

      const { tl, tr, bl, br } = getCornerPoints(contour)
      if (!tl || !tr || !bl || !br) { self.postMessage({ id, ok: false }); return }

      const w = Math.round(Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y)))
      const h = Math.round(Math.max(Math.hypot(bl.x - tl.x, bl.y - tl.y), Math.hypot(br.x - tr.x, br.y - tr.y)))
      if (w < 50 || h < 50) { self.postMessage({ id, ok: false }); return }

      // Reject implausible detections: a sliver, or essentially the whole frame.
      const ratio = (w * h) / (mat.cols * mat.rows)
      if (ratio < 0.15 || ratio > 0.98) { self.postMessage({ id, ok: false }); return }

      const buffer = warp(mat, { tl, tr, bl, br }, w, h)
      self.postMessage({ id, ok: true, width: w, height: h, buffer: buffer.buffer }, [buffer.buffer])
    } finally {
      contour?.delete?.()
      mat.delete()
    }
  } catch {
    self.postMessage({ id, ok: false })
  }
}
