import { PDFDocument } from 'pdf-lib'
import { isPdfEncrypted } from './savePdf'

/** Thrown when the source file can't be split (encrypted or corrupted). */
export class UnsplittablePdfError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'UnsplittablePdfError'
  }
}

/** Loads a PDF just far enough to report its page count. */
export async function getPageCount(bytes: ArrayBuffer): Promise<number> {
  if (await isPdfEncrypted(bytes)) {
    throw new UnsplittablePdfError("This PDF is encrypted or has security restrictions and can't be split.")
  }
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes)
  } catch {
    throw new UnsplittablePdfError('Could not read this file — it may be corrupted.')
  }
  return doc.getPageCount()
}

/**
 * Parse a range string like "1-3, 5, 8-10" (1-based, inclusive) into a
 * sorted, deduplicated list of 0-based page indices. Throws with a message
 * naming the offending token on any invalid or out-of-range input.
 */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Enter at least one page or range.')

  const indices = new Set<number>()
  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim()
    if (!token) continue

    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token)
    const singleMatch = /^(\d+)$/.exec(token)

    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
        throw new Error(`"${token}" is outside the document's ${pageCount} pages.`)
      }
      if (start > end) throw new Error(`"${token}" is backwards — start must come before end.`)
      for (let p = start; p <= end; p++) indices.add(p - 1)
    } else if (singleMatch) {
      const page = Number(singleMatch[1])
      if (page < 1 || page > pageCount) {
        throw new Error(`"${token}" is outside the document's ${pageCount} pages.`)
      }
      indices.add(page - 1)
    } else {
      throw new Error(`"${token}" isn't a page number or range.`)
    }
  }

  if (indices.size === 0) throw new Error('Enter at least one page or range.')
  return [...indices].sort((a, b) => a - b)
}

/** Inverse of parsePageRanges: collapse sorted 0-based indices into "1-3, 5, 8-10". */
export function formatPageRanges(indices: number[]): string {
  if (indices.length === 0) return ''
  const sorted = [...indices].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i]
    if (current === prev + 1) {
      prev = current
      continue
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
    if (i < sorted.length) {
      start = current
      prev = current
    }
  }
  return parts.join(', ')
}

/** Extract the given 0-based page indices into a single new PDF's bytes. */
export async function extractPages(bytes: ArrayBuffer, indices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes)
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  pages.forEach((p) => out.addPage(p))
  return out.save()
}

/** Split the given 0-based page indices into one single-page PDF each, in order. */
export async function splitToIndividualPdfs(
  bytes: ArrayBuffer,
  indices: number[],
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const src = await PDFDocument.load(bytes)
  const results: { name: string; bytes: Uint8Array }[] = []
  for (const index of indices) {
    const out = await PDFDocument.create()
    const [page] = await out.copyPages(src, [index])
    out.addPage(page)
    results.push({ name: `page-${index + 1}.pdf`, bytes: await out.save() })
  }
  return results
}
