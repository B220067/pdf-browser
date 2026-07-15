/**
 * Word-level hit-testing against the rendered PDF page.
 *
 * pdf.js's TextLayer renders one <span> per text-showing operation in the
 * PDF's content stream, not one per word — a title is very often a single
 * `Tj` call for the whole string, so its span covers the entire line. To
 * find individual words within a span we can't rely on span boundaries at
 * all, so we split each span's text into words with `Intl.Segmenter`.
 *
 * Getting each word's on-screen RECT is the harder part. pdf.js's text
 * layer doesn't use the PDF's real font for hit-testing — it substitutes a
 * generic system font, then applies one CSS scale-x to the whole span so
 * its *total* rendered width matches the true glyph run's width. That
 * correction is only ever right on average: it doesn't fix the position of
 * anything *inside* the line (error compounds letter by letter the further
 * a word sits from the line's start — measured ~5% of the page width for
 * the last word of a bold heading), and the span's own box runs well above
 * and below the actual glyph ink (a "line box", not a tight fit), so
 * boxes built from it alone can look visibly detached from the text.
 *
 * The canvas the page is actually rendered onto doesn't have either
 * problem — it's the exact pixels the user sees. lib/canvasInk.ts reads it
 * directly: finds the tight vertical ink band for a span, then splits that
 * band into exactly as many pieces as `Intl.Segmenter` says there are
 * words, by cutting at the widest gaps. When a span's background can't be
 * read this way (e.g. light text — see canvasInk's isInk) or there isn't
 * a clean per-letter gap to split on, this falls back to the character-
 * count approximation, which is cruder but never fails outright.
 */

import { findInkRowBands, segmentIntoWords } from './canvasInk'

export interface WordHit {
  text: string
  rect: DOMRect
}

/** Per-span cache, keyed by the span element itself, so a drag gesture's
 *  repeated pointermove events don't re-scan canvas pixels for the same
 *  line dozens of times a second. Invalidated by comparing against the
 *  span's own current rect — cheap, and correct across zoom/reflow since a
 *  changed rect means the cached pixel positions no longer apply. */
const spanWordCache = new WeakMap<Element, { sig: string; words: WordHit[] }>()

function rectSignature(r: DOMRect): string {
  return `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`
}

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null

/** Word-like segments of `text`, as [start, end) character offsets. */
function wordSpans(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  if (segmenter) {
    for (const seg of segmenter.segment(text)) {
      if (!seg.isWordLike) continue
      out.push({ text: seg.segment, start: seg.index, end: seg.index + seg.segment.length })
    }
  } else {
    // Fallback for engines without Intl.Segmenter: split on runs of
    // non-whitespace, which misses locale-aware word boundaries (e.g. CJK
    // text with no spaces) but degrades gracefully for Latin-script text.
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** Character-count fallback for one span: cruder than a pixel-accurate fit,
 *  but requires nothing from the canvas and so never fails outright. */
function approximateWordsFromCharCount(full: string, spanRect: DOMRect): WordHit[] {
  const totalChars = full.length
  return wordSpans(full).map(({ text, start, end }) => {
    const left = spanRect.left + (start / totalChars) * spanRect.width
    const right = spanRect.left + (end / totalChars) * spanRect.width
    return { text, rect: new DOMRect(left, spanRect.top, right - left, spanRect.height) }
  })
}

/** How far a span's canvas search window may extend past its own (possibly
 *  undershooting — see this file's top comment) box before it'd risk
 *  overlapping a neighboring span's own ink on the same line. Capped at
 *  half the gap to the nearest such neighbor, so padding generous enough to
 *  recover a badly-undershot trailing edge (common for the last word of a
 *  long/bold run) can never bleed into text that isn't part of this span. */
function searchPadding(spanRect: DOMRect, otherRects: readonly DOMRect[]): { left: number; right: number } {
  const GENEROUS_DEFAULT = spanRect.width * 0.25
  // Padding may go NEGATIVE (shrinking the window inside the span's own
  // box): adjacent same-line spans — a bold price run butted against the
  // regular text around it — can have boxes that touch or slightly overlap,
  // and half of any overlap belongs to the neighbor's glyphs, not ours.
  // Real adjacent-run overlap is a couple of px at most, so floor the
  // shrink accordingly — a large computed "overlap" means the neighbor
  // isn't really beside us and must not eat the window.
  const MAX_SHRINK = -Math.min(6, spanRect.width * 0.1)
  const spanMidY = (spanRect.top + spanRect.bottom) / 2
  const spanMidX = (spanRect.left + spanRect.right) / 2
  let left = GENEROUS_DEFAULT
  let right = GENEROUS_DEFAULT
  for (const r of otherRects) {
    // Same-line test by BASELINE PROXIMITY (vertical centers), not box
    // overlap: text-layer line boxes routinely overlap vertically at
    // cramped line spacing, and treating the (usually full-width) line
    // above/below as a same-line neighbor collapses the padding — or
    // worse, shrinks the window — for essentially every span on the page.
    if (Math.abs((r.top + r.bottom) / 2 - spanMidY) > Math.min(r.height, spanRect.height) / 2) continue
    const rMidX = (r.left + r.right) / 2
    if (rMidX <= spanMidX) left = Math.min(left, (spanRect.left - r.right) / 2)
    else right = Math.min(right, (r.left - spanRect.right) / 2)
  }
  return { left: Math.max(MAX_SHRINK, left), right: Math.max(MAX_SHRINK, right) }
}

/** Pixel-accurate words for one span, reading the actual rendered canvas —
 *  see this file's top comment. Returns null if the canvas can't yield a
 *  confident answer (no ink found, or fewer ink fragments than words),
 *  meaning the caller should fall back to the char-count approximation.
 *  `fontName` is pdf.js's real loaded font for this span, if confidently
 *  known (see PdfPage.tsx) — used to predict word-boundary positions
 *  against the PDF's actual font instead of a generic stand-in, which
 *  matters most exactly when it's most needed: a long/bold/stylized run
 *  where a generic font's proportions diverge furthest from the real one. */
function wordsFromCanvasInk(
  full: string,
  spanRect: DOMRect,
  pad: { left: number; right: number },
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  fontName: string | null,
): WordHit[] | null {
  const words = wordSpans(full)
  if (words.length === 0) return null

  const canvasRect = canvas.getBoundingClientRect()
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null
  const sx = canvas.width / canvasRect.width
  const sy = canvas.height / canvasRect.height
  const toCanvasX = (clientX: number) => (clientX - canvasRect.left) * sx
  const toCanvasY = (clientY: number) => (clientY - canvasRect.top) * sy

  // Search a window padded beyond the text layer's own (possibly
  // undershooting) box on all sides — vertically to not clip a true
  // ascender/descender, horizontally (see searchPadding) to recover a
  // trailing edge pdf.js's approximation placed short of the real glyphs.
  const yPad = spanRect.height * 0.15
  const xStart = toCanvasX(spanRect.left - pad.left)
  const xEnd = toCanvasX(spanRect.right + pad.right)
  const yStart = toCanvasY(spanRect.top - yPad)
  const yEnd = toCanvasY(spanRect.bottom + yPad)

  // The padded window can graze the text line above or below this span —
  // especially for a big heading whose loose line box already reaches
  // toward a tightly-spaced paragraph. Pick the ink band that overlaps this
  // span's own (unpadded) vertical range the most, rather than treating all
  // ink in the window as one band — a fused band would let the neighbor
  // line's ink fill this line's word gaps and corrupt the column scan.
  const bands = findInkRowBands(ctx, xStart, xEnd, yStart, yEnd)
  if (bands.length === 0) return null
  const spanTopC = toCanvasY(spanRect.top)
  const spanBottomC = toCanvasY(spanRect.bottom)
  const overlapWith = (b: { start: number; end: number }) =>
    Math.max(0, Math.min(b.end, spanBottomC) - Math.max(b.start, spanTopC))
  const rowBand = bands.reduce((a, b) => (overlapWith(b) > overlapWith(a) ? b : a))
  if (overlapWith(rowBand) <= 0) return null

  const runs = segmentIntoWords(ctx, xStart, xEnd, rowBand.start, rowBand.end, full, words, fontName)
  if (!runs) return null

  const fromCanvasX = (canvasX: number) => canvasRect.left + canvasX / sx
  const top = canvasRect.top + rowBand.start / sy
  const bottom = canvasRect.top + rowBand.end / sy
  return words.map(({ text }, i) => ({
    text,
    rect: new DOMRect(fromCanvasX(runs[i].start), top, fromCanvasX(runs[i].end) - fromCanvasX(runs[i].start), bottom - top),
  }))
}

/** Every word in every text-layer span. Exported so callers can look at a
 *  word's UNMATCHED neighbors too — e.g. to know how far a matched
 *  selection can safely grow without encroaching on text that wasn't
 *  touched (see RedactLayer.tsx's wordSnappedBox).
 *
 *  `fontNames`, if given, are pdf.js's real loaded font per span, in the
 *  same order as the rendered spans (see PdfPage.tsx) — used to measure
 *  word-boundary predictions against the PDF's actual font. Pass null (or
 *  a shorter/mismatched array) when unavailable; spans beyond its length
 *  or with a null entry just fall back to a generic font. */
export function allWordHits(container: HTMLElement, fontNames?: readonly (string | null)[] | null): WordHit[] {
  // The page canvas is a sibling of the text layer container (see
  // PdfPage.tsx) — same page, so pixel positions line up directly.
  const canvas = container.parentElement?.querySelector('canvas') ?? null
  const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null

  const spans = [...container.querySelectorAll('span')].filter((s) => s.textContent?.trim())
  const spanRects = spans.map((s) => s.getBoundingClientRect())

  const hits: WordHit[] = []
  spans.forEach((span, i) => {
    const spanRect = spanRects[i]
    if (spanRect.width <= 0 || spanRect.height <= 0) return

    const fontName = fontNames?.[i] ?? null
    const sig = `${rectSignature(spanRect)}|${fontName ?? ''}`
    const cached = spanWordCache.get(span)
    if (cached && cached.sig === sig) {
      hits.push(...cached.words)
      return
    }

    const full = span.textContent ?? ''
    const pad = searchPadding(spanRect, spanRects.filter((_, j) => j !== i))
    const words =
      (canvas && ctx && wordsFromCanvasInk(full, spanRect, pad, canvas, ctx, fontName)) ??
      approximateWordsFromCharCount(full, spanRect)
    spanWordCache.set(span, { sig, words })
    hits.push(...words)
  })
  return hits
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** A minimum-coverage threshold since word rects are an approximation, not
 *  exact glyph bounds: a box that just barely grazes a word's edge shouldn't
 *  claim that whole word is about to be redacted. Horizontal coverage only
 *  (not full 2D area) — a redaction box that sweeps across a word but isn't
 *  drawn exactly line-height tall (very common; users don't drag pixel-
 *  perfect rectangles) shouldn't fail the check on vertical coverage alone
 *  when it's unambiguous which word was meant. */
const MIN_WORD_COVERAGE = 0.5

/** Every word in `container` where at least MIN_WORD_COVERAGE of the word's
 *  own horizontal extent falls inside `clientRect` (both in viewport
 *  client-coordinate space) — "most of the word is covered", not just any
 *  overlap at all. */
export function wordsIntersecting(
  container: HTMLElement,
  clientRect: DOMRect,
  fontNames?: readonly (string | null)[] | null,
): WordHit[] {
  return allWordHits(container, fontNames).filter((hit) => {
    if (!rectsOverlap(hit.rect, clientRect)) return false
    const overlapWidth = Math.min(hit.rect.right, clientRect.right) - Math.max(hit.rect.left, clientRect.left)
    if (!(hit.rect.width > 0) || overlapWidth / hit.rect.width < MIN_WORD_COVERAGE) return false
    // Vertically require a real slice of the word, not a 1px graze — a
    // drag along one line shouldn't catch the line above/below just
    // because a word's box (or a descender) barely pokes into it.
    const overlapHeight = Math.min(hit.rect.bottom, clientRect.bottom) - Math.max(hit.rect.top, clientRect.top)
    return hit.rect.height > 0 && overlapHeight / hit.rect.height >= 0.25
  })
}

/** The single word (if any) rendered at the given client point — a point has
 *  no area to apply a coverage ratio to, so this is a plain containment
 *  test. Used for a click, which has no drag rectangle to intersect. */
export function wordAtPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  fontNames?: readonly (string | null)[] | null,
): WordHit | null {
  return (
    allWordHits(container, fontNames).find(
      (hit) => clientX >= hit.rect.left && clientX <= hit.rect.right && clientY >= hit.rect.top && clientY <= hit.rect.bottom,
    ) ?? null
  )
}

/** Group word hits into visual lines (by rect bottom, within `tolerance` CSS
 *  px) — mirrors the same bottom-anchored grouping PdfPage.tsx's highlighter
 *  uses, since bottoms stay consistent within a line while tops can drift a
 *  few px depending on which glyphs a rect happens to enclose. */
export function groupByLine(hits: readonly WordHit[], tolerance = 8): WordHit[][] {
  const lines: WordHit[][] = []
  for (const hit of [...hits].sort((a, b) => a.rect.bottom - b.rect.bottom)) {
    const line = lines.find((group) => Math.abs(group[0].rect.bottom - hit.rect.bottom) < tolerance)
    if (line) line.push(hit)
    else lines.push([hit])
  }
  return lines
}
