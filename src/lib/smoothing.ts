import type { Point } from '../types'

const fmt = (n: number): string => {
  const s = n.toFixed(2)
  return s === '-0.00' ? '0.00' : s
}

/**
 * Turn a raw polyline into a smooth SVG path using midpoint quadratic
 * beziers: each recorded point becomes the control point of a curve that
 * ends at the midpoint to the next point. The same path string is used for
 * the live on-screen <path> and (after mapping every coordinate into PDF
 * space) for pdf-lib's drawSvgPath, so screen and file match exactly —
 * bezier curves are preserved under the affine display→PDF mapping.
 *
 * @param transform Optional per-point coordinate mapping applied to every
 *   emitted coordinate (anchors, control points and endpoints alike).
 */
export function strokeToSvgPath(
  points: readonly Point[],
  transform: (p: Point) => Point = (p) => p,
): string {
  if (points.length === 0) return ''
  const pts = points.map(transform)
  const first = pts[0]
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`

  if (pts.length === 1) {
    // A tap: zero-length segment renders as a dot with round line caps.
    return `${d} L ${fmt(first.x)} ${fmt(first.y)}`
  }
  if (pts.length === 2) {
    return `${d} L ${fmt(pts[1].x)} ${fmt(pts[1].y)}`
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2
    const midY = (pts[i].y + pts[i + 1].y) / 2
    d += ` Q ${fmt(pts[i].x)} ${fmt(pts[i].y)} ${fmt(midX)} ${fmt(midY)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`
  return d
}
