/**
 * The font families we expose.
 * - 'Arial' isn't one of the PDF standard 14, but is metrically identical to
 *   Helvetica (same glyph widths), so it's saved as the built-in Helvetica.
 * - 'GreatVibes' is an open-source (OFL) cursive for typed signatures; it's
 *   bundled locally (src/assets) and embedded into the PDF at export — still
 *   zero external network requests.
 */
export const FONT_FAMILIES = ['Arial', 'TimesRoman', 'Courier', 'GreatVibes'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

export const FONT_LABELS: Record<FontFamily, string> = {
  Arial: 'Arial',
  TimesRoman: 'Times New Roman',
  Courier: 'Courier',
  GreatVibes: 'Great Vibes (cursive)',
}

/**
 * CSS stacks that visually match what will be baked into the file: the
 * standard fonts approximate, Great Vibes is the exact same TTF loaded via
 * @font-face in index.css.
 */
export const FONT_CSS_STACKS: Record<FontFamily, string> = {
  Arial: 'Arial, Helvetica, sans-serif',
  TimesRoman: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
  GreatVibes: '"Great Vibes", cursive',
}

/** Colors offered as one-click swatches wherever a color can be picked. */
export const PRESET_COLORS = ['#111827', '#1d4ed8', '#dc2626', '#15803d'] as const

export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48] as const

/** Shared between the DOM overlay (CSS line-height) and pdf-lib (lineHeight). */
export const LINE_HEIGHT = 1.2

export interface Point {
  x: number
  y: number
}

/**
 * All editable elements store coordinates in "displayed page space":
 * PDF points (1/72 inch), origin at the TOP-LEFT of the page *as rendered*
 * (i.e. after the page's /Rotate is applied), independent of zoom.
 * `lib/coords.ts` converts this to structural bottom-left PDF space on save.
 */
export interface TextElement {
  id: string
  pageIndex: number
  /** Top-left corner of the first line of text, displayed page space. */
  x: number
  y: number
  text: string
  /** Font size in PDF points. */
  fontSize: number
  fontFamily: FontFamily
  /** Hex color, e.g. "#111827". */
  color: string
  /** Text formatting. */
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** 'left' | 'center' | 'right' */
  align?: 'left' | 'center' | 'right'
  /** Opacity 0-1 */
  opacity?: number
}

export interface Stroke {
  id: string
  pageIndex: number
  /** Polyline in displayed page space; smoothed to beziers at render/save time. */
  points: Point[]
  /** Stroke width in PDF points. */
  width: number
  color: string
  /**
   * Strokes stamped together (one signature stamp) share a groupId so
   * selecting any part selects — and moves — the whole signature as one.
   * Hand-drawn strokes have none and select individually.
   */
  groupId?: string
  /** Opacity 0-1 (for highlighter). */
  opacity?: number
}

export type Tool = 'select' | 'text' | 'draw' | 'erase' | 'stamp' | 'highlight' | 'redact'

/**
 * A permanent black-box redaction, displayed page space (see Stroke/TextElement).
 * Unlike a highlight stroke, this is never drawn as a see-through overlay: at
 * export time the whole page it sits on is rasterized and the box is painted
 * onto the raster, so the content underneath is not present in the saved file
 * in any recoverable form (see `lib/savePdf.ts`).
 */
export interface RedactionBox {
  id: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * A signature drawn once (in the signature-capture modal) and reused across
 * pages. Strokes are stored relative to the capture canvas's own origin;
 * stamping translates every point by the click offset.
 */
export interface SignatureTemplate {
  strokes: { points: Point[]; width: number; color: string }[]
}

/** Capture-canvas size in PDF points — sets how big a stamped signature is. */
export const SIGNATURE_TEMPLATE_WIDTH = 220
export const SIGNATURE_TEMPLATE_HEIGHT = 90

/**
 * One entry per page in the document AS CURRENTLY ARRANGED. Reordering
 * permutes this array, deleting removes an entry, rotating bumps
 * rotationDelta. Elements keep referencing their page by ORIGINAL index, so
 * page moves never invalidate stored text/stroke coordinates.
 */
export interface PageEntry {
  originalIndex: number
  /** Extra user-applied rotation on top of the page's own /Rotate. */
  rotationDelta: 0 | 90 | 180 | 270
}

export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown'

/**
 * One widget (visual instance) of an AcroForm field, detected via pdf.js
 * `getAnnotations`. A logical field can have several widgets — e.g. each
 * radio option is its own widget sharing the parent field's name. Values
 * live separately in `formFieldValues`, keyed by fieldName, so multi-widget
 * fields stay in sync automatically.
 */
export interface FormWidget {
  id: string
  fieldName: string
  kind: FormFieldKind
  /** Original page index (same convention as TextElement/Stroke). */
  pageIndex: number
  /** [x1, y1, x2, y2] in structural PDF space (bottom-left origin). */
  rect: [number, number, number, number]
  /** The "on" value this widget represents (checkbox/radio only). */
  exportValue?: string
  /** Dropdown choices. */
  options?: { exportValue: string; displayValue: string }[]
  multiLine?: boolean
  readOnly?: boolean
}

export type FormFieldValue = string | boolean

/**
 * Geometry captured from pdf.js when a page is first loaded. Everything the
 * save step needs to map displayed coordinates back onto the structural page.
 */
export interface PageGeometry {
  pageIndex: number
  /** Displayed size at scale 1, in PDF points (width/height swap when rotated 90/270). */
  width: number
  height: number
  /** Normalized page /Rotate value. */
  rotation: 0 | 90 | 180 | 270
  /** Crop box (pdf.js `view`) in unrotated structural space. */
  viewX: number
  viewY: number
  viewWidth: number
  viewHeight: number
}
