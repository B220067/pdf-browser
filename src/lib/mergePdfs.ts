import { PDFDocument } from 'pdf-lib'
import { isPdfEncrypted } from './savePdf'

/** Thrown for a specific file that can't be merged, so the UI can name it. */
export class UnmergeableFileError extends Error {
  constructor(fileName: string, reason: string) {
    super(`"${fileName}" ${reason}`)
    this.name = 'UnmergeableFileError'
  }
}

/** Concatenate PDFs in the given order into one new document's bytes. */
export async function mergePdfs(files: File[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const file of files) {
    const bytes = await file.arrayBuffer()
    if (await isPdfEncrypted(bytes)) {
      throw new UnmergeableFileError(
        file.name,
        "is encrypted or has security restrictions and can't be merged.",
      )
    }
    let src: PDFDocument
    try {
      src = await PDFDocument.load(bytes)
    } catch {
      throw new UnmergeableFileError(file.name, 'could not be read — the file may be corrupted.')
    }
    const pages = await merged.copyPages(src, src.getPageIndices())
    pages.forEach((p) => merged.addPage(p))
  }
  return merged.save()
}
