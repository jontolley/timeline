import { requireOptionalNativeModule } from 'expo'

// JS side of modules/hindsite-documents (Swift: ios/HindsiteDocumentsModule.swift).
// Optional so a dev build made before this module existed still runs; the
// document options just stay hidden there.

export type DocumentFile = {
  uri: string
  pageCount: number
  // Page 1 as a JPEG, for the tile and the uploaded thumbnail. Missing for a
  // locked PDF.
  thumbUri?: string
  thumbWidth?: number
  thumbHeight?: number
}

type NativeModule = {
  isScanningSupported(): boolean
  scanDocument(): Promise<DocumentFile | null>
  imagesToPdf(uris: string[]): Promise<DocumentFile>
  pdfInfo(uri: string): Promise<DocumentFile>
}

const native = requireOptionalNativeModule<NativeModule>('HindsiteDocuments')

export const documentsAvailable = native != null

export function canScanDocuments(): boolean {
  return native?.isScanningSupported() ?? false
}

// Opens the document camera; null when the user cancels.
export function scanDocument(): Promise<DocumentFile | null> {
  if (!native) return Promise.reject(new Error('Scanning needs a newer build of the app.'))
  return native.scanDocument()
}

export function imagesToPdf(uris: string[]): Promise<DocumentFile> {
  if (!native) return Promise.reject(new Error('This needs a newer build of the app.'))
  return native.imagesToPdf(uris)
}

export function pdfInfo(uri: string): Promise<DocumentFile> {
  if (!native) return Promise.reject(new Error('This needs a newer build of the app.'))
  return native.pdfInfo(uri)
}
