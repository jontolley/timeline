import { pdfjs } from 'react-pdf'
// Vite's `?worker` form returns a Worker constructor that's been bundled
// correctly as a module Web Worker. Using `workerPort` (a pre-instantiated
// Worker) instead of `workerSrc` (a URL) sidesteps MIME-type mismatches when
// the static host (e.g. nginx) doesn't map `.mjs` to a JS MIME type, which
// would otherwise cause `new Worker(url, { type: 'module' })` to refuse to
// load and break both upload-time thumbnails and the inline viewer.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

export { pdfjs }
