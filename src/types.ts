/** The three PDF built-in (standard 14) font families we expose. */
export const FONT_FAMILIES = ['Helvetica', 'TimesRoman', 'Courier'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

export const FONT_LABELS: Record<FontFamily, string> = {
  Helvetica: 'Helvetica',
  TimesRoman: 'Times New Roman',
  Courier: 'Courier',
}

/**
 * CSS stacks that visually approximate the PDF standard fonts so the
 * on-screen overlay matches what pdf-lib will bake into the file.
 */
export const FONT_CSS_STACKS: Record<FontFamily, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  TimesRoman: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
}

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
}

export interface Stroke {
  id: string
  pageIndex: number
  /** Polyline in displayed page space; smoothed to beziers at render/save time. */
  points: Point[]
  /** Stroke width in PDF points. */
  width: number
  color: string
}

export type Tool = 'select' | 'text' | 'draw' | 'erase'

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
