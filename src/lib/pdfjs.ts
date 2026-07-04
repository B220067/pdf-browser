import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Vite serves the worker as a static asset; no CDN, everything stays local.
GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Open a PDF with pdf.js. NOTE: pdf.js *transfers* the underlying buffer to
 * its worker (detaching it), so we always hand it a private copy and the
 * caller keeps the original bytes for pdf-lib to re-open at save time.
 */
export function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes.slice(0) }).promise
}
