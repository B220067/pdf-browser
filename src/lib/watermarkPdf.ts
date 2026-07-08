import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { hexToRgb01 } from './coords'
import { isPdfEncrypted } from './savePdf'

/** Thrown when the source file can't be stamped (encrypted or corrupted). */
export class UnstampablePdfError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'UnstampablePdfError'
  }
}

export interface WatermarkOptions {
  text: string
  fontSize: number
  /** Hex color, e.g. "#94a3b8". */
  color: string
  /** 0-1 */
  opacity: number
  /** Degrees, counterclockwise. A classic diagonal stamp is ~45. */
  rotationDeg: number
}

export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'top-left'
  | 'top-right'

export interface PageNumberOptions {
  /** May contain "{n}" (page number) and "{total}" (page count). */
  format: string
  startAt: number
  fontSize: number
  color: string
  position: PageNumberPosition
}

/** Distance in PDF points from the page edge to a page-number stamp; also used by the live preview. */
export const MARGIN = 24

/** Center a (possibly rotated) run of text on a given point. */
function drawCenteredText(
  page: import('pdf-lib').PDFPage,
  text: string,
  font: import('pdf-lib').PDFFont,
  center: { x: number; y: number },
  size: number,
  rotationDeg: number,
  color: { r: number; g: number; b: number },
  opacity: number,
): void {
  const angleRad = (rotationDeg * Math.PI) / 180
  const textWidth = font.widthOfTextAtSize(text, size)
  const textHeight = font.heightAtSize(size)
  const dx = textWidth / 2
  const dy = textHeight / 2
  const anchorX = center.x - (dx * Math.cos(angleRad) - dy * Math.sin(angleRad))
  const anchorY = center.y - (dx * Math.sin(angleRad) + dy * Math.cos(angleRad))
  page.drawText(text, {
    x: anchorX,
    y: anchorY,
    size,
    font,
    color: rgb(color.r, color.g, color.b),
    opacity,
    rotate: degrees(rotationDeg),
  })
}

function positionFor(
  position: PageNumberPosition,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
): { x: number; y: number } {
  const y = position.startsWith('bottom') ? MARGIN : pageHeight - MARGIN - fontSize
  if (position.endsWith('left')) return { x: MARGIN, y }
  if (position.endsWith('right')) return { x: pageWidth - MARGIN - textWidth, y }
  return { x: (pageWidth - textWidth) / 2, y }
}

/** Stamp a diagonal watermark and/or page numbers across every page. */
export async function applyStamp(
  bytes: ArrayBuffer,
  watermark: WatermarkOptions | null,
  pageNumbers: PageNumberOptions | null,
): Promise<Uint8Array> {
  if (await isPdfEncrypted(bytes)) {
    throw new UnstampablePdfError("This PDF is encrypted or has security restrictions and can't be edited.")
  }
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes)
  } catch {
    throw new UnstampablePdfError('Could not read this file — it may be corrupted.')
  }

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const total = pages.length

  const watermarkColor = watermark ? hexToRgb01(watermark.color) : null
  const pageNumberColor = pageNumbers ? hexToRgb01(pageNumbers.color) : null

  pages.forEach((page, i) => {
    const { width, height } = page.getSize()

    if (watermark && watermark.text.trim() && watermarkColor) {
      drawCenteredText(
        page,
        watermark.text.trim(),
        font,
        { x: width / 2, y: height / 2 },
        watermark.fontSize,
        watermark.rotationDeg,
        watermarkColor,
        watermark.opacity,
      )
    }

    if (pageNumbers && pageNumberColor) {
      const label = pageNumbers.format
        .replace(/\{n\}/g, String(pageNumbers.startAt + i))
        .replace(/\{total\}/g, String(total))
      const textWidth = font.widthOfTextAtSize(label, pageNumbers.fontSize)
      const { x, y } = positionFor(pageNumbers.position, width, height, textWidth, pageNumbers.fontSize)
      page.drawText(label, {
        x,
        y,
        size: pageNumbers.fontSize,
        font,
        color: rgb(pageNumberColor.r, pageNumberColor.g, pageNumberColor.b),
      })
    }
  })

  return doc.save()
}
