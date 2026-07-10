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
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib'
import { TextLayer } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import type {
  FontFamily,
  FormFieldValue,
  PageEntry,
  PageGeometry,
  RedactionBox,
  Stroke,
  TextElement,
} from '../types'
import greatVibesUrl from '../assets/GreatVibes-Regular.ttf?url'
import { LINE_HEIGHT } from '../types'
import { displayedToPdf, effectiveGeometry, hexToRgb01, normalizeRotation } from './coords'
import { loadPdf } from './pdfjs'
import { findTextShowingOperations, removeByteRanges, type TextShowingOp } from './redactContentStream'
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
  redactions?: readonly RedactionBox[],
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

  if (redactions && redactions.length > 0) {
    await applyRedactions(doc, slots, redactions)
  }

  return doc.save()
}

/** Raster resolution for redacted pages: 72 * 3 = 216 DPI — sharp enough for
 *  print/zoom while keeping file size and render time reasonable. */
const REDACTION_RASTER_SCALE = 3

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to rasterize page for redaction'))
        return
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject)
    }, 'image/png')
  })
}

interface DisplayBox {
  x: number
  y: number
  width: number
  height: number
}

function boxesOverlap(a: DisplayBox, b: DisplayBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Map a displayed-space rect (top-left origin, y-down) to a structural PDF
 *  rect (bottom-left origin, y-up) via both diagonal corners — exact for the
 *  rotation=0 case this is only ever called in (see the rotation guard in
 *  `tryPreciseRedaction`). */
function displayRectToStructural(b: DisplayBox, geom: PageGeometry): DisplayBox {
  const c1 = displayedToPdf({ x: b.x, y: b.y }, geom)
  const c2 = displayedToPdf({ x: b.x + b.width, y: b.y + b.height }, geom)
  return {
    x: Math.min(c1.x, c2.x),
    y: Math.min(c1.y, c2.y),
    width: Math.abs(c2.x - c1.x),
    height: Math.abs(c2.y - c1.y),
  }
}

/** True if any XObject in the page's /Resources is an Image — used as a
 *  conservative "too complex, don't attempt precise redaction" signal, since
 *  an image under a redaction box needs the same removal this pass only does
 *  for text; see the module doc comment on `tryPreciseRedaction`. */
function pageHasImageXObject(doc: PDFDocument, page: PDFPage): boolean {
  const resources = page.node.Resources()
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return false
  for (const value of xobjects.values()) {
    const obj: PDFObject | undefined = value instanceof PDFRef ? doc.context.lookup(value) : value
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : undefined
    if (dict?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.toString() === '/Image') return true
  }
  return false
}

/**
 * Read a page's full content-stream bytes, decoded and concatenated in
 * order (a PDF page's /Contents may be a single stream or an array of them —
 * readers treat an array as logically concatenated, so this does too).
 * Returns null if any entry isn't a stream type this can decode, which the
 * caller treats as "too complex, fall back to rasterizing the page."
 */
function readPageContentBytes(doc: PDFDocument, page: PDFPage): Uint8Array | null {
  const contents = page.node.Contents()
  if (!contents) return new Uint8Array(0)

  const entries: PDFObject[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i)
      const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
      if (!obj) return null
      entries.push(obj)
    }
  } else {
    entries.push(contents)
  }

  const chunks: Uint8Array[] = []
  for (const entry of entries) {
    if (entry instanceof PDFContentStream) chunks.push(entry.getUnencodedContents())
    else if (entry instanceof PDFRawStream) chunks.push(decodePDFRawStream(entry).decode())
    else return null
  }

  const total = chunks.reduce((sum, c) => sum + c.length + 1, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
    out[pos] = 0x20 // PDF requires content streams to be joined as if by whitespace
    pos += 1
  }
  return out.subarray(0, pos)
}

/** Replace a page's /Contents with a single new (uncompressed) stream holding `bytes`. */
function writePageContentBytes(doc: PDFDocument, page: PDFPage, bytes: Uint8Array): void {
  const stream = doc.context.stream(bytes)
  const ref = doc.context.register(stream)
  page.node.set(PDFName.of('Contents'), ref)
}

/**
 * Render the page's text layer off-screen (same pdf.js `TextLayer` class the
 * live editor uses for the highlighter) purely to measure each REAL text
 * item's on-page bounding box via `getBoundingClientRect()` — far more
 * reliable than re-deriving pdf.js's glyph-transform math by hand.
 *
 * pdf.js's `getTextContent()` doesn't emit one item per content-stream
 * text-showing operation — it also inserts synthetic items of its own: an
 * empty-string item as an internal line-break marker (which `TextLayer`
 * silently renders no span for at all), and whitespace-only items to
 * represent an inferred gap between two separately-positioned operations
 * that weren't actually a space character in the stream. Both are filtered
 * out here (by re-aligning items 1:1 with rendered spans first, since only
 * the empty-string case drops a span; then dropping whitespace-only entries
 * from both in lockstep) so what's left is exactly the real operations, in
 * order — which is what the caller needs to line up against its own count
 * of real `Tj`/`TJ` operations found in the raw content stream.
 *
 * Returns null if the span/item counts can't be reconciled at all, which
 * the caller treats as "not confident enough to attempt precise redaction."
 */
async function measureTextItemBoxes(pjsPage: PDFPageProxy, width: number, height: number): Promise<DisplayBox[] | null> {
  const textContent = await pjsPage.getTextContent()
  const viewport = pjsPage.getViewport({ scale: 1 })
  const container = document.createElement('div')
  container.className = 'textLayer'
  container.style.position = 'fixed'
  container.style.left = '0px'
  container.style.top = '0px'
  container.style.visibility = 'hidden'
  container.style.fontSize = '0'
  container.style.setProperty('--total-scale-factor', '1')
  // pdf.js's TextLayer constructor sets the container's width/height itself,
  // to `round(down, calc(var(--total-scale-factor) * <page size>), var(--scale-round-x))`.
  // Without these two custom properties (normally supplied by pdf.js's own
  // pdf_viewer.css, which this app deliberately doesn't import — see the
  // comment on the `.textLayer` rule in index.css) that `round()` is
  // invalid, and the container collapses to 0×0 — every span still renders
  // and sizes correctly, but every position ends up wrongly reported as
  // (0,0) relative to it. Match pdf_viewer.css's own values.
  container.style.setProperty('--scale-round-x', '1px')
  container.style.setProperty('--scale-round-y', '1px')
  document.body.appendChild(container)
  try {
    const task = new TextLayer({ textContentSource: textContent, container, viewport })
    await task.render()
    const spans = container.querySelectorAll('span')

    const nonEmptyItems = textContent.items.filter(
      (it): it is typeof it & { str: string } => 'str' in it && it.str !== '',
    )
    if (nonEmptyItems.length !== spans.length) return null

    const containerRect = container.getBoundingClientRect()
    if (containerRect.width !== width || containerRect.height !== height) return null
    const boxes: DisplayBox[] = []
    for (let i = 0; i < nonEmptyItems.length; i++) {
      if (nonEmptyItems[i].str.trim() === '') continue // synthetic inferred-gap space, not a real operation
      const r = spans[i].getBoundingClientRect()
      boxes.push({ x: r.left - containerRect.left, y: r.top - containerRect.top, width: r.width, height: r.height })
    }
    return boxes
  } finally {
    document.body.removeChild(container)
  }
}

/** Padding (displayed-space points) added around a removed item's crop so
 *  its raster patch overlaps neighboring untouched text slightly rather than
 *  leaving a hairline seam — safe since the patch shows real page pixels
 *  outside the redaction box, identical to what's already there. */
const PATCH_PADDING = 2

/**
 * Attempt word-level redaction: delete only the specific text-showing
 * operations that overlap a redaction box, leaving every other operation in
 * the page's content stream — and therefore every other word, line, and
 * paragraph on the page — exactly as it was, still real and selectable.
 *
 * This only proceeds when every one of several independent checks confirms
 * it's safe to trust:
 *  - the page has no image XObjects (an image under a box needs removal too,
 *    which this pass doesn't attempt — bail rather than leave it recoverable)
 *  - the content stream tokenizes cleanly (no inline images, no malformed
 *    syntax — see redactContentStream.ts)
 *  - the number of text-showing operations found in the raw bytes matches
 *    pdf.js's own independently-computed text item count for the page, AND
 *    matches the number of rendered text-layer spans — two separate
 *    consistency checks that only both pass when the "Nth operation is the
 *    Nth item" assumption this relies on actually holds for this page
 *  - the page isn't rotated (kept out of scope for this pass — see the
 *    module's design notes on image placement math)
 *
 * Any failure returns false and leaves `doc` completely untouched, so the
 * caller's whole-page rasterization fallback — the same one used before this
 * function existed — applies instead. Nothing here weakens that guarantee;
 * it only widens the set of pages that can avoid it.
 *
 * A removed run isn't just deleted outright: since the user's box may only
 * cover part of it (e.g. a box reaching partway through a word), the run's
 * full original pixels are rasterized into a small local patch with just the
 * boxed portion baked solid black, so anything outside the box still looks
 * exactly as before — it just stops being real text, same as the rest of a
 * whole-page fallback would.
 */
async function tryPreciseRedaction(
  doc: PDFDocument,
  page: PDFPage,
  pjsPage: PDFPageProxy,
  geom: PageGeometry,
  boxes: readonly RedactionBox[],
  pageCanvas: HTMLCanvasElement,
): Promise<boolean> {
  if (geom.rotation !== 0) return false
  if (pageHasImageXObject(doc, page)) return false

  const contentBytes = readPageContentBytes(doc, page)
  if (!contentBytes) return false

  const textOps = findTextShowingOperations(contentBytes)
  if (!textOps) return false

  const itemBoxes = await measureTextItemBoxes(pjsPage, geom.width, geom.height)
  if (!itemBoxes) return false
  if (itemBoxes.length !== textOps.length) return false

  const opsToRemove: TextShowingOp[] = []
  const removedItemBoxes: DisplayBox[] = []
  for (let idx = 0; idx < textOps.length; idx++) {
    const itemBox = itemBoxes[idx]
    if (itemBox.width <= 0 || itemBox.height <= 0) continue
    if (boxes.some((b) => boxesOverlap(itemBox, b))) {
      opsToRemove.push(textOps[idx])
      removedItemBoxes.push(itemBox)
    }
  }

  // Every check passed — now safe to actually mutate the document.
  const newContentBytes = removeByteRanges(contentBytes, opsToRemove)
  writePageContentBytes(doc, page, newContentBytes)

  // Full box coverage first (handles any part of a box not explained by a
  // removed run — blank margin, decorative graphics, etc).
  for (const b of boxes) {
    const s = displayRectToStructural(b, geom)
    page.drawRectangle({ x: s.x, y: s.y, width: s.width, height: s.height, color: rgb(0, 0, 0) })
  }

  // Then patch each removed run back in as pixels: real page content outside
  // any box, solid black inside one — so the parts the box never touched
  // still look untouched, just no longer selectable as text.
  for (const itemBox of removedItemBoxes) {
    const crop: DisplayBox = {
      x: Math.max(0, itemBox.x - PATCH_PADDING),
      y: Math.max(0, itemBox.y - PATCH_PADDING),
      width: Math.min(geom.width, itemBox.x + itemBox.width + PATCH_PADDING) - Math.max(0, itemBox.x - PATCH_PADDING),
      height:
        Math.min(geom.height, itemBox.y + itemBox.height + PATCH_PADDING) - Math.max(0, itemBox.y - PATCH_PADDING),
    }
    if (crop.width <= 0 || crop.height <= 0) continue

    const srcX = Math.round(crop.x * REDACTION_RASTER_SCALE)
    const srcY = Math.round(crop.y * REDACTION_RASTER_SCALE)
    const srcW = Math.round(crop.width * REDACTION_RASTER_SCALE)
    const srcH = Math.round(crop.height * REDACTION_RASTER_SCALE)
    if (srcW <= 0 || srcH <= 0) continue

    const patchCanvas = document.createElement('canvas')
    patchCanvas.width = srcW
    patchCanvas.height = srcH
    const patchCtx = patchCanvas.getContext('2d')
    if (!patchCtx) continue
    patchCtx.drawImage(pageCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)

    patchCtx.fillStyle = '#000000'
    for (const b of boxes) {
      if (!boxesOverlap(crop, b)) continue
      const localX = (b.x - crop.x) * REDACTION_RASTER_SCALE
      const localY = (b.y - crop.y) * REDACTION_RASTER_SCALE
      patchCtx.fillRect(localX, localY, b.width * REDACTION_RASTER_SCALE, b.height * REDACTION_RASTER_SCALE)
    }

    const pngBytes = await canvasToPngBytes(patchCanvas)
    const image = await doc.embedPng(pngBytes)
    const s = displayRectToStructural(crop, geom)
    page.drawImage(image, { x: s.x, y: s.y, width: s.width, height: s.height })
  }

  return true
}

/**
 * Permanently remove redacted content. For every page carrying at least one
 * redaction box, first try `tryPreciseRedaction` (removes only the specific
 * words a box touches, leaving the rest of the page as real text). If that
 * declines — anything about the page it isn't confident about — fall back to
 * rasterizing the whole page: paint the boxes onto a full-page raster of
 * everything already drawn (all other edits are baked in by the loop above,
 * so it matches exactly what's on screen), then replace the page's entire
 * vector content with that flattened image.
 *
 * Either way, this is the only reliable way to guarantee the underlying
 * text is actually gone from the saved file. Drawing a black rectangle over
 * live content (what `highlight` does) leaves the original text intact and
 * trivially extractable via copy-paste or a text-extraction tool.
 */
async function applyRedactions(
  doc: PDFDocument,
  slots: { page: PDFPage; originalIndex: number; geom: PageGeometry }[],
  redactions: readonly RedactionBox[],
): Promise<void> {
  const byPage = new Map<number, RedactionBox[]>()
  for (const r of redactions) {
    if (r.width <= 0 || r.height <= 0) continue
    const list = byPage.get(r.pageIndex)
    if (list) list.push(r)
    else byPage.set(r.pageIndex, [r])
  }
  if (byPage.size === 0) return

  // Re-open what's been written so far (text/strokes/forms already drawn
  // onto `doc`'s pages) so the rasterized page matches the live preview,
  // boxes and all.
  const intermediate = await doc.save()
  const buffer = intermediate.buffer.slice(
    intermediate.byteOffset,
    intermediate.byteOffset + intermediate.byteLength,
  ) as ArrayBuffer
  const pdfjsDoc = await loadPdf(buffer)

  try {
    // Each whole-page-fallback iteration replaces exactly one page in `doc`
    // (insert + remove nets to zero length change at that same index), so
    // indices for every OTHER slot stay valid regardless of processing
    // order. The precise path never changes the page count either.
    for (let i = 0; i < slots.length; i++) {
      const { originalIndex, geom, page } = slots[i]
      const boxes = byPage.get(originalIndex)
      if (!boxes || boxes.length === 0) continue

      const pjsPage = await pdfjsDoc.getPage(i + 1)
      const viewport = pjsPage.getViewport({ scale: REDACTION_RASTER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      await pjsPage.render({ canvas, viewport }).promise

      const precise = await tryPreciseRedaction(doc, page, pjsPage, geom, boxes, canvas)
      if (precise) continue

      // Box coordinates are in the same "displayed page space" this render
      // uses at scale 1 (see coords.ts), so scaling by REDACTION_RASTER_SCALE
      // lands exactly on the matching canvas pixels.
      ctx.fillStyle = '#000000'
      for (const box of boxes) {
        ctx.fillRect(
          box.x * REDACTION_RASTER_SCALE,
          box.y * REDACTION_RASTER_SCALE,
          box.width * REDACTION_RASTER_SCALE,
          box.height * REDACTION_RASTER_SCALE,
        )
      }

      const pngBytes = await canvasToPngBytes(canvas)
      const image = await doc.embedPng(pngBytes)

      const flatPage = doc.insertPage(i, [geom.width, geom.height])
      flatPage.drawImage(image, { x: 0, y: 0, width: geom.width, height: geom.height })
      doc.removePage(i + 1)
    }
  } finally {
    await pdfjsDoc.destroy()
  }
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
