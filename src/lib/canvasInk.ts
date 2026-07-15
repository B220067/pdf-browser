/**
 * Pixel-level "where is the ink" scanning of a rendered PDF page canvas.
 *
 * Used to correct word rects that lib/textLayerWords.ts derives from
 * pdf.js's text layer, which measurably drifts for large/bold/long text
 * (see that file's own notes). The canvas is ground truth — it's the exact
 * pixels the user sees — so reading it directly sidesteps the text layer's
 * substitute-font approximation entirely, both for the word's tight
 * vertical ink band (the text layer's line box runs well above and below
 * the actual glyphs) and for the line's true horizontal extent.
 *
 * Within a line, word POSITIONS are not derived from pixel gaps alone —
 * see segmentIntoWords for why gap-counting is fragile — but from measured
 * text widths in the PDF's real font, with pixel gaps used only to refine
 * boundary edges when one clearly lines up.
 */

/** A pixel counts as "ink" if it's not close to white — works for the
 *  overwhelmingly common case of dark text on a white/near-white page.
 *  Doesn't attempt to handle light text on a dark background; callers treat
 *  "no ink found at all" as a signal to fall back to the text-layer
 *  approximation rather than produce a wrong answer. */
function isInk(data: Uint8ClampedArray, i: number): boolean {
  return data[i + 3] >= 128 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235)
}

export interface PixelRun {
  start: number
  end: number
}

/** Rows within a text line are effectively continuous ink; rows between two
 *  lines are blank for at least a couple of pixels even at cramped line
 *  spacing (a descender and the next line's ascender never actually touch).
 *  A blank run longer than this splits two bands. Keep this tight: at 1.15
 *  line-height the gap between lines can be as little as 2-3 rows, and a
 *  fused band lets the neighbor line's ink fill this line's word gaps. */
const BAND_SPLIT_BLANK_ROWS = 1

/**
 * ALL contiguous vertical ink bands within the given canvas-pixel region,
 * top to bottom. Callers pick the band belonging to their line — critical
 * when the search window (a text-layer line box plus padding) also grazes
 * the line above or below: treating first-ink-row..last-ink-row as one band
 * would fuse both lines, and a column scan of that fused band sees the
 * neighbor line's ink filling this line's word gaps. Returns [] on no ink,
 * or if the canvas is unreadable.
 */
export function findInkRowBands(
  ctx: CanvasRenderingContext2D,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
): PixelRun[] {
  const w = Math.max(1, Math.round(xEnd - xStart))
  const h = Math.max(1, Math.round(yEnd - yStart))
  const y0 = Math.round(yStart)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(Math.round(xStart), y0, w, h).data
  } catch {
    return []
  }
  const rowHasInk = new Array<boolean>(h).fill(false)
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4
    for (let x = 0; x < w; x++) {
      if (isInk(data, rowOffset + x * 4)) {
        rowHasInk[y] = true
        break
      }
    }
  }
  const bands: PixelRun[] = []
  let bandStart = -1
  let blanks = 0
  for (let y = 0; y <= h; y++) {
    if (y < h && rowHasInk[y]) {
      if (bandStart === -1) bandStart = y
      blanks = 0
    } else if (bandStart !== -1) {
      blanks++
      if (blanks > BAND_SPLIT_BLANK_ROWS || y === h) {
        bands.push({ start: y0 + bandStart, end: y0 + y - blanks + 1 })
        bandStart = -1
        blanks = 0
      }
    }
  }
  return bands
}

/** Contiguous ink column runs within the given canvas-pixel region, in
 *  left-to-right order — raw glyph-ish fragments. Returns [] when there is
 *  no ink or the canvas is unreadable. */
export function inkColumnRuns(
  ctx: CanvasRenderingContext2D,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
): PixelRun[] {
  const w = Math.max(1, Math.round(xEnd - xStart))
  const h = Math.max(1, Math.round(yEnd - yStart))
  const x0 = Math.round(xStart)
  const y0 = Math.round(yStart)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(x0, y0, w, h).data
  } catch {
    return []
  }
  const colHasInk = new Array<boolean>(w).fill(false)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (isInk(data, (y * w + x) * 4)) {
        colHasInk[x] = true
        break
      }
    }
  }
  const runs: PixelRun[] = []
  let runStart = -1
  for (let x = 0; x <= w; x++) {
    const has = x < w && colHasInk[x]
    if (has && runStart === -1) runStart = x
    else if (!has && runStart !== -1) {
      runs.push({ start: x0 + runStart, end: x0 + x })
      runStart = -1
    }
  }
  return runs
}

/** How close (as a fraction of the line's ink extent) a real pixel gap must
 *  be to a measured-width boundary prediction to snap the boundary onto it. */
const GAP_SNAP_TOLERANCE = 0.03

/**
 * Lay the given words out along a line's actual rendered ink.
 *
 * Two earlier approaches failed on real documents and shaped this design:
 *
 * 1. "Split at the N-1 widest pixel gaps" broke when a font's internal
 *    letter-gap was wider than a real word gap ("Blueprint" split in two, a
 *    real boundary lost).
 * 2. "Predict boundary positions, snap each to its nearest gap" broke when
 *    one prediction was slightly off — its wrong gap choice consumed a gap
 *    the next boundary needed, corrupting the rest of the line. And any
 *    approach that HAS to find exactly N-1 gaps fails outright (falling
 *    back to a much cruder path) when neighboring-line ink bleeds into the
 *    scan and fills the gaps.
 *
 * So this never counts gaps at all. Word positions come from measured text
 * widths in the PDF's real font (pdf.js loads the actual embedded font as
 * a usable canvas font — measured proportions match the PDF's true metrics
 * to well under 1%): each word's fractional [left, right] within the line
 * is the measured width of the text before/through it over the whole
 * line's measured width, mapped onto the line's true pixel ink extent.
 * Real pixel gaps only fine-tune: when a gap sits within GAP_SNAP_TOLERANCE
 * of a predicted between-word boundary, the neighboring words' edges snap
 * to that gap's edges. No gap nearby (touching glyphs, bled-in ink,
 * strange kerning) just means that one boundary keeps its measured
 * position — nothing fails, nothing cascades.
 *
 * `fullText` is the span's whole string; `wordRanges` are [start, end)
 * character offsets of each word within it (so inter-word spacing and
 * punctuation are naturally accounted for by the prefix measurements).
 */
export function segmentIntoWords(
  ctx: CanvasRenderingContext2D,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
  fullText: string,
  wordRanges: readonly { start: number; end: number }[],
  fontName: string | null,
): PixelRun[] | null {
  if (wordRanges.length === 0) return null
  const runs = inkColumnRuns(ctx, xStart, xEnd, yStart, yEnd)
  if (runs.length === 0) return null
  const inkLeft = runs[0].start
  const inkRight = runs[runs.length - 1].end
  const extent = inkRight - inkLeft
  if (extent <= 0) return null

  // Measured prefix widths in the PDF's real font (quoted defensively;
  // generic fallback if the name isn't a loaded font). 200px reference size
  // for measurement precision — only ratios are used.
  //
  // The measured space must cover ALL ink-producing characters — every
  // non-whitespace character, not just the words. A span like
  // ". Going 50-50 means…" (a bold price ends the previous span, so this
  // one begins with the sentence's period) has leading punctuation whose
  // pixels are part of the ink extent; measuring from the first WORD
  // instead would map "Going" onto the period's pixels and shift every
  // word in the span left by the punctuation's width. Same reasoning at
  // the end, and for a single-word span like "$746,800" whose "$"/"." are
  // not part of the word: no full-extent shortcut, the word's box must
  // come from its measured share just like any other.
  const firstInk = fullText.length - fullText.trimStart().length
  const lastInk = fullText.trimEnd().length
  const prevFont = ctx.font
  ctx.font = fontName ? `200px "${fontName}", sans-serif` : '200px sans-serif'
  const prefix = (i: number) => ctx.measureText(fullText.slice(0, i)).width
  const base = prefix(firstInk)
  const total = prefix(lastInk) - base
  const fracs = wordRanges.map(({ start, end }) => ({
    left: (prefix(start) - base) / total,
    right: (prefix(end) - base) / total,
  }))
  ctx.font = prevFont
  if (!(total > 0) || fracs.some((f) => !isFinite(f.left) || !isFinite(f.right))) return null

  const toX = (frac: number) => inkLeft + frac * extent

  // Interior gaps between ink runs, as candidate snap targets.
  const gaps = runs.slice(1).map((r, i) => ({ start: runs[i].end, end: r.start, mid: (runs[i].end + r.start) / 2 }))
  const tolerance = extent * GAP_SNAP_TOLERANCE

  const words: PixelRun[] = wordRanges.map((_, i) => ({ start: toX(fracs[i].left), end: toX(fracs[i].right) }))

  for (let i = 0; i < words.length - 1; i++) {
    const predicted = (toX(fracs[i].right) + toX(fracs[i + 1].left)) / 2
    let best: (typeof gaps)[number] | null = null
    let bestDist = tolerance
    for (const gap of gaps) {
      const dist = Math.abs(gap.mid - predicted)
      if (dist < bestDist) {
        bestDist = dist
        best = gap
      }
    }
    if (best) {
      words[i].end = best.start
      words[i + 1].start = best.end
    }
  }

  return words
}
