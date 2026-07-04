import type { PageGeometry, Point } from '../types'

/**
 * Coordinate translation between the two worlds:
 *
 *  - "Displayed page space": what the user interacts with. Origin top-left of
 *    the page as rendered on screen (after /Rotate), y grows DOWNWARD, units
 *    are PDF points (we divide screen pixels by the render scale before
 *    storing anything, so zoom never leaks into stored coordinates).
 *
 *  - "Structural PDF space": what pdf-lib writes. Origin bottom-left of the
 *    unrotated page, y grows UPWARD, units are PostScript points (1/72").
 *
 * The mapping below is the exact inverse of the pdf.js PageViewport transform
 * for each of the four legal /Rotate values, including the crop-box offset
 * (pages whose MediaBox/CropBox doesn't start at 0,0 are a classic source of
 * mis-placed annotations).
 */
export function displayedToPdf(pt: Point, g: PageGeometry): Point {
  const { viewX: vx, viewY: vy, viewWidth: vw, viewHeight: vh } = g
  switch (g.rotation) {
    case 90:
      return { x: vx + pt.y, y: vy + pt.x }
    case 180:
      return { x: vx + (vw - pt.x), y: vy + pt.y }
    case 270:
      return { x: vx + (vw - pt.y), y: vy + (vh - pt.x) }
    default:
      return { x: vx + pt.x, y: vy + (vh - pt.y) }
  }
}

/** Normalize an arbitrary /Rotate value (may be negative or >360) to 0|90|180|270. */
export function normalizeRotation(rotate: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360
  return r as 0 | 90 | 180 | 270
}

/** Convert a pointer event's client coordinates into displayed page space. */
export function clientToDisplayed(
  clientX: number,
  clientY: number,
  pageRect: DOMRect,
  g: PageGeometry,
): Point {
  // Derive the effective scale from the live bounding box rather than trusting
  // the nominal zoom value — immune to browser zoom and subpixel layout.
  const scaleX = pageRect.width / g.width
  const scaleY = pageRect.height / g.height
  return {
    x: clamp((clientX - pageRect.left) / scaleX, 0, g.width),
    y: clamp((clientY - pageRect.top) / scaleY, 0, g.height),
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** "#rrggbb" → {r,g,b} each in 0..1, as pdf-lib expects. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 }
}
