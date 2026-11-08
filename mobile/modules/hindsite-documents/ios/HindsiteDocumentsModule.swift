import ExpoModulesCore
import PDFKit
import UIKit
import VisionKit

// Documents for a moment, built on the phone so they upload like any other
// PDF (no backend change):
// - scanDocument: the system document camera (the one Notes and Files use),
//   which finds the page edges and straightens each page. The pages come back
//   as one PDF.
// - imagesToPdf: photos from the library, one per page, in the order given.
// - pdfInfo: page count plus a page-1 JPEG for the tile thumbnail, the native
//   stand-in for the web's pdf.js render.
// Each returns { uri, pageCount, thumbUri?, thumbWidth?, thumbHeight? }.

private let pageMaxPixels: CGFloat = 2000 // matches the web's FULL_MAX_DIM
private let pageLongSide: CGFloat = 792 // US Letter's long side, in points
private let jpegQuality: CGFloat = 0.85
private let thumbMaxPixels: CGFloat = 400

public class HindsiteDocumentsModule: Module {
  // The scanner's delegate is weak, so hold it while the camera is up.
  private var scanDelegate: ScanDelegate?

  public func definition() -> ModuleDefinition {
    Name("HindsiteDocuments")

    Function("isScanningSupported") {
      VNDocumentCameraViewController.isSupported
    }

    // Resolves null when the user cancels.
    AsyncFunction("scanDocument") { (promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject("E_SCAN_UNSUPPORTED", "This device can't scan documents.")
        return
      }
      guard self.scanDelegate == nil else {
        promise.reject("E_SCAN_BUSY", "A scan is already open.")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_VIEW", "Couldn't open the scanner.")
        return
      }
      let scanner = VNDocumentCameraViewController()
      let delegate = ScanDelegate { [weak self] controller, outcome in
        controller.dismiss(animated: true)
        self?.scanDelegate = nil
        switch outcome {
        case .cancelled:
          promise.resolve(nil)
        case .failed(let error):
          promise.reject("E_SCAN_FAILED", error.localizedDescription)
        case .scanned(let scan):
          let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
          DispatchQueue.global(qos: .userInitiated).async {
            do {
              promise.resolve(try writePdf(images, name: "Scan"))
            } catch {
              promise.reject("E_PDF", error.localizedDescription)
            }
          }
        }
      }
      self.scanDelegate = delegate
      scanner.delegate = delegate
      presenter.present(scanner, animated: true)
    }
    .runOnQueue(.main)

    AsyncFunction("imagesToPdf") { (uris: [String]) -> [String: Any] in
      guard !uris.isEmpty else { throw DocumentError("Pick at least one photo.") }
      let images = try uris.map { uri -> UIImage in
        guard let image = UIImage(contentsOfFile: fileUrl(uri).path) else {
          throw DocumentError("Couldn't read one of those photos.")
        }
        return image
      }
      return try writePdf(images, name: "Photos")
    }

    AsyncFunction("pdfInfo") { (uri: String) -> [String: Any] in
      try pdfInfo(fileUrl(uri))
    }
  }
}

private enum ScanOutcome {
  case scanned(VNDocumentCameraScan)
  case cancelled
  case failed(Error)
}

private class ScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  let done: (VNDocumentCameraViewController, ScanOutcome) -> Void
  init(done: @escaping (VNDocumentCameraViewController, ScanOutcome) -> Void) { self.done = done }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    done(controller, scan.pageCount > 0 ? .scanned(scan) : .cancelled)
  }
  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    done(controller, .cancelled)
  }
  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    done(controller, .failed(error))
  }
}

private struct DocumentError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

private func fileUrl(_ uri: String) -> URL {
  if let url = URL(string: uri), url.isFileURL { return url }
  return URL(fileURLWithPath: uri)
}

private func outputUrl(_ ext: String) throws -> URL {
  let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("hindsite-documents", isDirectory: true)
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
}

// Draw `image` (orientation applied) at most `maxPixels` on its long side,
// on white so transparent PNGs don't turn black in a JPEG.
private func flattened(_ image: UIImage, maxPixels: CGFloat) -> UIImage {
  let w = image.size.width * image.scale
  let h = image.size.height * image.scale
  let ratio = max(w, h) > maxPixels ? maxPixels / max(w, h) : 1
  let size = CGSize(width: max(1, (w * ratio).rounded()), height: max(1, (h * ratio).rounded()))
  let format = UIGraphicsImageRendererFormat()
  format.scale = 1
  format.opaque = true
  return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
    UIColor.white.setFill()
    ctx.fill(CGRect(origin: .zero, size: size))
    image.draw(in: CGRect(origin: .zero, size: size))
  }
}

// One page per image. Each page keeps its image's shape, sized so the long
// side is a Letter page's, and the image is stored as a JPEG.
private func writePdf(_ images: [UIImage], name: String) throws -> [String: Any] {
  let document = PDFDocument()
  for (index, image) in images.enumerated() {
    let pageImage = flattened(image, maxPixels: pageMaxPixels)
    let scale = pageLongSide / max(pageImage.size.width, pageImage.size.height)
    let box = CGRect(
      x: 0, y: 0,
      width: (pageImage.size.width * scale).rounded(),
      height: (pageImage.size.height * scale).rounded()
    )
    guard let page = PDFPage(image: pageImage, options: [.mediaBox: box, .compressionQuality: jpegQuality]) else {
      throw DocumentError("Couldn't add page \(index + 1).")
    }
    document.insert(page, at: index)
  }
  let url = try outputUrl("pdf")
  guard document.write(to: url) else { throw DocumentError("Couldn't save the PDF.") }
  return try pdfInfo(url)
}

private func pdfInfo(_ url: URL) throws -> [String: Any] {
  guard let document = PDFDocument(url: url) else {
    throw DocumentError("That file isn't a PDF we can read.")
  }
  var info: [String: Any] = ["uri": url.absoluteString, "pageCount": document.pageCount]
  // A locked PDF still attaches; it just gets the plain document tile.
  if !document.isLocked, let page = document.page(at: 0), let thumb = try? pageThumb(page) {
    info["thumbUri"] = thumb.uri
    info["thumbWidth"] = thumb.width
    info["thumbHeight"] = thumb.height
  }
  return info
}

private func pageThumb(_ page: PDFPage) throws -> (uri: String, width: Int, height: Int) {
  var bounds = page.bounds(for: .mediaBox).size
  if page.rotation % 180 != 0 { bounds = CGSize(width: bounds.height, height: bounds.width) }
  guard bounds.width > 0, bounds.height > 0 else { throw DocumentError("Empty page.") }
  let scale = thumbMaxPixels / max(bounds.width, bounds.height)
  let size = CGSize(width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())
  let image = flattened(page.thumbnail(of: size, for: .mediaBox), maxPixels: thumbMaxPixels)
  guard let data = image.jpegData(compressionQuality: 0.8) else { throw DocumentError("Couldn't render the page.") }
  let url = try outputUrl("jpg")
  try data.write(to: url)
  return (url.absoluteString, Int(image.size.width), Int(image.size.height))
}
