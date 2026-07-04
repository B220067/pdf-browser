import {
  PDFDocument,
  StandardFonts,
  LineCapStyle,
  degrees,
  rgb,
  type PDFFont,
} from 'pdf-lib'
import type { FontFamily, PageGeometry, Stroke, TextElement } from '../types'
import { LINE_HEIGHT } from '../types'
import { displayedToPdf, hexToRgb01 } from './coords'
import { strokeToSvgPath } from './smoothing'

const STANDARD_FONT_MAP: Record<FontFamily, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
}

/**
 * The PDF standard 14 fonts only support WinAnsi encoding. Replace anything
 * outside that repertoire (emoji, CJK, …) instead of letting pdf-lib throw
 * mid-save. Newlines are kept — drawText handles them via `lineHeight`.
 */
const NON_WIN_ANSI =
  // eslint-disable-next-line no-control-regex
  /[^\n\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g

function sanitizeForWinAnsi(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(NON_WIN_ANSI, '?')
}

/**
 * Thrown when the source PDF is encrypted. pdf-lib has no encryption/
 * decryption support: loading with `ignoreEncryption: true` reads the raw
 * (still-encrypted) content streams as-is and `save()` re-emits the original
 * `/Encrypt` trailer entry unchanged. The result is not a "protection
 * removed" copy — it's a malformed file whose newly-added content was never
 * actually encrypted but is now referenced by stale encryption metadata
 * (verified: pdf.js refuses to reopen such a file at all, even though the
 * source needed no password). So this is a hard stop, not a confirmable risk.
 */
export class EncryptedPdfError extends Error {
  constructor() {
    super('This PDF is encrypted or has security restrictions and cannot be edited.')
    this.name = 'EncryptedPdfError'
  }
}

/** True if the PDF has an `/Encrypt` entry, regardless of whether a user password is required to view it. */
export async function isPdfEncrypted(bytes: ArrayBuffer): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return doc.isEncrypted
}

/**
 * Re-open the ORIGINAL bytes with pdf-lib and stitch every overlay element
 * onto its page in structural PDF coordinates.
 *
 * Text placement: the overlay renders each text box with CSS
 * `line-height: LINE_HEIGHT` starting at (x, y) top-left. pdf-lib's drawText
 * anchors at the BASELINE of the first line, so we drop from the top edge by
 * the CSS half-leading plus the font ascent, then map that displayed-space
 * baseline point into structural space. On rotated pages the text itself is
 * rotated by the page's /Rotate angle so it reads upright on screen.
 */
export async function exportEditedPdf(
  originalBytes: ArrayBuffer,
  geometries: readonly PageGeometry[],
  texts: readonly TextElement[],
  strokes: readonly Stroke[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  if (doc.isEncrypted) throw new EncryptedPdfError()
  const pages = doc.getPages()

  const fontCache = new Map<FontFamily, PDFFont>()
  const fontFor = async (family: FontFamily): Promise<PDFFont> => {
    let font = fontCache.get(family)
    if (!font) {
      font = await doc.embedFont(STANDARD_FONT_MAP[family])
      fontCache.set(family, font)
    }
    return font
  }

  for (const el of texts) {
    const text = sanitizeForWinAnsi(el.text)
    if (!text.trim()) continue
    const page = pages[el.pageIndex]
    const g = geometries[el.pageIndex]
    if (!page || !g) continue

    const font = await fontFor(el.fontFamily)
    const lineHeight = el.fontSize * LINE_HEIGHT
    const ascent = font.heightAtSize(el.fontSize, { descender: false })
    const glyphHeight = font.heightAtSize(el.fontSize) // ascent + |descent|
    const halfLeading = (lineHeight - glyphHeight) / 2
    // First-line baseline, still in displayed (top-left, y-down) space:
    const baseline = { x: el.x, y: el.y + halfLeading + ascent }
    const anchor = displayedToPdf(baseline, g)
    const { r, g: gg, b } = hexToRgb01(el.color)

    page.drawText(text, {
      x: anchor.x,
      y: anchor.y,
      size: el.fontSize,
      font,
      color: rgb(r, gg, b),
      lineHeight,
      rotate: degrees(g.rotation),
    })
  }

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue
    const page = pages[stroke.pageIndex]
    const g = geometries[stroke.pageIndex]
    if (!page || !g) continue

    // Map every path coordinate (anchors AND bezier control points) through
    // the displayed→structural transform. drawSvgPath interprets path
    // coordinates as y-DOWN relative to its (x, y) option, so with the
    // anchor at the origin we emit (x_pdf, -y_pdf) to land on (x_pdf, y_pdf).
    const d = strokeToSvgPath(stroke.points, (p) => {
      const m = displayedToPdf(p, g)
      return { x: m.x, y: -m.y }
    })
    const { r, g: gg, b } = hexToRgb01(stroke.color)

    page.drawSvgPath(d, {
      x: 0,
      y: 0,
      borderWidth: stroke.width,
      borderColor: rgb(r, gg, b),
      borderLineCap: LineCapStyle.Round,
      borderOpacity: 1,
    })
  }

  return doc.save()
}

/** Trigger a client-side download of the given bytes. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function editedFileName(original: string): string {
  const base = original.replace(/\.pdf$/i, '')
  return `${base}-edited.pdf`
}
