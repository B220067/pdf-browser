import {
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  LineCapStyle,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type {
  FontFamily,
  FormFieldValue,
  PageEntry,
  PageGeometry,
  Stroke,
  TextElement,
} from '../types'
import greatVibesUrl from '../assets/GreatVibes-Regular.ttf?url'
import { LINE_HEIGHT } from '../types'
import { displayedToPdf, effectiveGeometry, hexToRgb01, normalizeRotation } from './coords'
import { strokeToSvgPath } from './smoothing'

const STANDARD_FONT_MAP: Partial<Record<FontFamily, StandardFonts>> = {
  // Arial isn't a PDF standard-14 font; Helvetica is its metrically-identical
  // substitute (same glyph widths), so text laid out as "Arial" reflows
  // exactly the same when saved as Helvetica.
  Arial: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
  // GreatVibes is not here: it's a bundled TTF embedded via fontkit below.
}

const BOLD_FONT_MAP: Partial<Record<StandardFonts, StandardFonts>> = {
  [StandardFonts.Helvetica]: StandardFonts.HelveticaBold,
  [StandardFonts.TimesRoman]: StandardFonts.TimesRomanBold,
  [StandardFonts.Courier]: StandardFonts.CourierBold,
}

const ITALIC_FONT_MAP: Partial<Record<StandardFonts, StandardFonts>> = {
  [StandardFonts.Helvetica]: StandardFonts.HelveticaOblique,
  [StandardFonts.TimesRoman]: StandardFonts.TimesRomanItalic,
  [StandardFonts.Courier]: StandardFonts.CourierOblique,
}

const BOLD_ITALIC_FONT_MAP: Partial<Record<StandardFonts, StandardFonts>> = {
  [StandardFonts.Helvetica]: StandardFonts.HelveticaBoldOblique,
  [StandardFonts.TimesRoman]: StandardFonts.TimesRomanBoldItalic,
  [StandardFonts.Courier]: StandardFonts.CourierBoldOblique,
}

/** Fetched once per session; the TTF is a local bundled asset, not a CDN. */
let greatVibesBytes: Promise<ArrayBuffer> | null = null
function loadGreatVibes(): Promise<ArrayBuffer> {
  greatVibesBytes ??= fetch(greatVibesUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to load bundled font (${r.status})`)
    return r.arrayBuffer()
  })
  return greatVibesBytes
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
/**
 * Write the user's field values into the source document's real AcroForm
 * fields, then flatten so the values become permanent page content (matching
 * how text/strokes are baked in). Runs BEFORE any page copy/reorder step:
 * pdf-lib's copyPages doesn't carry the document-level AcroForm across to a
 * new document, so live fields would be lost — flattened content copies
 * fine. Failures degrade gracefully: a field that can't be set is skipped,
 * and if flattening fails the form is left filled-but-interactive.
 */
function fillFormFields(doc: PDFDocument, values: Record<string, FormFieldValue>): void {
  let form
  try {
    form = doc.getForm()
  } catch {
    return // no AcroForm
  }
  let anySet = false
  for (const field of form.getFields()) {
    const name = field.getName()
    if (!(name in values)) continue
    const value = values[name]
    try {
      if (field instanceof PDFTextField) {
        field.setText(sanitizeForWinAnsi(String(value ?? '')))
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check()
        else field.uncheck()
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value !== '' && value !== 'Off') {
          // Our stored value is the widget's appearance-state name (what
          // pdf.js reports as buttonValue). When the group has an /Opt array
          // (pdf-lib-created forms), select() expects the option label
          // instead — map state-name → option by index.
          const options = field.getOptions()
          if (options.includes(value)) {
            field.select(value)
          } else {
            const onValues = field.acroField
              .getOnValues()
              .map((n) => n.decodeText())
            const idx = onValues.indexOf(value)
            if (idx >= 0 && idx < options.length) field.select(options[idx])
            else console.warn(`Radio option "${value}" not found for "${name}"`)
          }
        }
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value !== '') field.select(value)
      } else {
        continue
      }
      anySet = true
    } catch (err) {
      console.warn(`Could not set form field "${name}"`, err)
    }
  }
  if (!anySet) return
  try {
    form.flatten()
  } catch (err) {
    console.warn('Form flatten failed; leaving fields interactive', err)
    try {
      form.updateFieldAppearances()
    } catch {
      // best effort — viewers will regenerate appearances themselves
    }
  }
}

export async function exportEditedPdf(
  originalBytes: ArrayBuffer,
  geometries: readonly PageGeometry[],
  texts: readonly TextElement[],
  strokes: readonly Stroke[],
  pageOrder?: readonly PageEntry[],
  formValues?: Record<string, FormFieldValue>,
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  if (srcDoc.isEncrypted) throw new EncryptedPdfError()

  if (formValues && Object.keys(formValues).length > 0) {
    fillFormFields(srcDoc, formValues)
  }

  const identity =
    !pageOrder ||
    (pageOrder.length === geometries.length &&
      pageOrder.every((e, i) => e.originalIndex === i && e.rotationDelta === 0))

  // Each output slot: the final page object, plus which original page's
  // elements land on it and the (rotation-adjusted) geometry to map with.
  let slots: { page: PDFPage; originalIndex: number; geom: PageGeometry }[]
  let doc: PDFDocument

  if (identity) {
    // Common case: untouched page arrangement — draw straight onto the
    // loaded document, exactly as before page management existed.
    doc = srcDoc
    slots = doc.getPages().map((page, i) => ({ page, originalIndex: i, geom: geometries[i] }))
  } else {
    // Deleted/reordered/rotated: rebuild into a fresh document. pdf-lib has
    // no reorder primitive, so copy the kept pages across in display order.
    doc = await PDFDocument.create()
    const copied = await doc.copyPages(
      srcDoc,
      pageOrder.map((e) => e.originalIndex),
    )
    slots = copied.map((page, i) => {
      const { originalIndex, rotationDelta } = pageOrder[i]
      if (rotationDelta !== 0) {
        page.setRotation(degrees(normalizeRotation(page.getRotation().angle + rotationDelta)))
      }
      doc.addPage(page)
      return { page, originalIndex, geom: effectiveGeometry(geometries[originalIndex], rotationDelta) }
    })
  }

  const fontCache = new Map<string, PDFFont>()
  const fontFor = async (family: FontFamily, bold: boolean = false, italic: boolean = false): Promise<PDFFont> => {
    const cacheKey = `${family}:${bold}:${italic}`
    let font = fontCache.get(cacheKey)
    if (!font) {
      const standard = STANDARD_FONT_MAP[family]
      if (standard) {
        // For standard fonts, select the appropriate variant
        let fontEnum = standard
        if (bold && italic) {
          fontEnum = BOLD_ITALIC_FONT_MAP[standard] ?? standard
        } else if (bold) {
          fontEnum = BOLD_FONT_MAP[standard] ?? standard
        } else if (italic) {
          fontEnum = ITALIC_FONT_MAP[standard] ?? standard
        }
        font = await doc.embedFont(fontEnum)
      } else {
        // Great Vibes: embed (subsetted) from the bundled TTF. fontkit is
        // ~700 kB, so it's loaded lazily — only exports that actually use
        // the cursive font pay for it.
        const { default: fontkit } = await import('@pdf-lib/fontkit')
        doc.registerFontkit(fontkit)
        font = await doc.embedFont(await loadGreatVibes(), { subset: true })
      }
      fontCache.set(cacheKey, font)
    }
    return font
  }

  for (const { page, originalIndex, geom: g } of slots) {
    for (const el of texts) {
      if (el.pageIndex !== originalIndex) continue
      const text = sanitizeForWinAnsi(el.text)
      if (!text.trim()) continue

      const font = await fontFor(el.fontFamily, el.bold ?? false, el.italic ?? false)
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
      if (stroke.pageIndex !== originalIndex || stroke.points.length === 0) continue

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
        borderOpacity: stroke.opacity ?? 1,
      })
    }
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
