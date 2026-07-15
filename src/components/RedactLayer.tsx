import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { PageGeometry, RedactionBox, Tool } from '../types'
import { clamp } from '../lib/coords'
import { allWordHits, groupByLine, wordAtPoint, wordsIntersecting } from '../lib/textLayerWords'
import type { WordHit } from '../lib/textLayerWords'
import { TrashIcon } from './icons'

interface RedactLayerProps {
  geometry: PageGeometry
  redactions: RedactionBox[]
  tool: Tool
  selectedId: string | null
  /** The page's live text-layer div (see PdfPage.tsx) — read directly to
   *  preview, in real time, which words a box is about to catch. Reusing
   *  the same rendered spans the highlighter already selects from means the
   *  preview reflects exactly what pdf.js will report at save time,
   *  including cases where it merges adjacent words into one run (see
   *  lib/savePdf.ts's notes on `measureTextItemBoxes`). */
  textLayerContainer: RefObject<HTMLDivElement | null>
  /** pdf.js's real loaded font name per rendered span, in the same order as
   *  `textLayerContainer`'s spans — see PdfPage.tsx and
   *  lib/canvasInk.ts's measureRelativeWidths. Null (whole array, or this
   *  ref's value) means "not confidently available", not "no font": word
   *  splitting falls back to a generic font rather than guess wrong. */
  spanFontNames: RefObject<(string | null)[] | null>
  /** Whether this page qualifies for word-level removal at all (no images,
   *  not rotated — mirrors savePdf.ts's own early checks). When false, ANY
   *  box on this page results in the whole page being flattened, regardless
   *  of what it overlaps — the preview says so plainly rather than listing
   *  words that would be a misleading half-truth. */
  preciseRedactionPossible: boolean
  onCommitBox: (rect: { x: number; y: number; width: number; height: number }) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, dx: number, dy: number) => void
  onResize: (id: string, width: number, height: number) => void
  onDelete: (id: string) => void
}

/** A click (not a drag) with no word under the cursor creates a box this
 *  size, centered on the click point — e.g. for redacting part of an image. */
const DEFAULT_BOX_WIDTH = 140
const DEFAULT_BOX_HEIGHT = 22
/** Below this drag distance (page units), treat the gesture as a click. */
const CLICK_THRESHOLD = 4
const MIN_BOX_SIZE = 8
/** Small margin (page units) added around a word-snapped box so it doesn't
 *  razor-hug glyph edges — matches the padding convention savePdf.ts uses
 *  around a redacted run's own raster patch. */
const WORD_PADDING = 2

interface DraftRect {
  x: number
  y: number
  width: number
  height: number
}

interface PreviewItem {
  text: string
  rect: DraftRect
}

/**
 * Draw/select/move/resize permanent black-box redactions. Modeled after
 * InkLayer's pointer-capture drag pattern, but for axis-aligned rectangles
 * instead of freehand paths — a redaction is a rect, not a stroke.
 *
 * These boxes are rendered fully opaque, on top of every other layer, so the
 * on-screen preview already matches what happens at export: whatever is
 * under the box is visually gone. The actual removal of the underlying
 * content happens in lib/savePdf.ts by rasterizing the page (or, when
 * possible, removing just the affected words — see savePdf.ts).
 */
export function RedactLayer({
  geometry,
  redactions,
  tool,
  selectedId,
  textLayerContainer,
  spanFontNames,
  preciseRedactionPossible,
  onCommitBox,
  onSelect,
  onMove,
  onResize,
  onDelete,
}: RedactLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const drawRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startClientX: number
    startClientY: number
  } | null>(null)
  const moveRef = useRef<{
    pointerId: number
    id: string
    lastClientX: number
    lastClientY: number
    box: RedactionBox
  } | null>(null)
  const resizeRef = useRef<{ pointerId: number; id: string; box: RedactionBox } | null>(null)

  const toLocal = (e: ReactPointerEvent): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * geometry.width, 0, geometry.width),
      y: clamp(((e.clientY - rect.top) / rect.height) * geometry.height, 0, geometry.height),
    }
  }

  /** Displayed page-space (this SVG's viewBox units) <-> viewport client
   *  space, so word rects from the DOM text layer (necessarily in client
   *  space — that's what getClientRects() reports) can be drawn in the SVG
   *  and compared against the page-space draft rect the user is dragging. */
  const clientToLocalRect = (r: DOMRect, svgRect: DOMRect): DraftRect => {
    const sx = svgRect.width / geometry.width
    const sy = svgRect.height / geometry.height
    return {
      x: (r.left - svgRect.left) / sx,
      y: (r.top - svgRect.top) / sy,
      width: r.width / sx,
      height: r.height / sy,
    }
  }
  const localToClientRect = (rect: DraftRect, svgRect: DOMRect): DOMRect => {
    const sx = svgRect.width / geometry.width
    const sy = svgRect.height / geometry.height
    return new DOMRect(svgRect.left + rect.x * sx, svgRect.top + rect.y * sy, rect.width * sx, rect.height * sy)
  }

  /** Which individual words (not whole text-layer spans — see
   *  lib/textLayerWords.ts for why that distinction matters, especially for
   *  titles) a candidate rect (displayed page space) currently overlaps. */
  const updatePreview = (rect: DraftRect) => {
    const container = textLayerContainer.current
    const svgRect = svgRef.current?.getBoundingClientRect()
    if (!container || !svgRect || svgRect.width === 0 || svgRect.height === 0) {
      setPreview(null)
      return
    }
    const hits = wordsIntersecting(container, localToClientRect(rect, svgRect), spanFontNames.current)
    setPreview(hits.map((h) => ({ text: h.text, rect: clientToLocalRect(h.rect, svgRect) })))
  }

  /** The word-snapped box for a finished drag: if every word the drag
   *  touched sits on one visual line, snap toward their union (like
   *  selecting text) instead of the raw freeform rectangle the user dragged
   *  — that raw rectangle is what used to catch a whole title in one go.
   *  Returns null (meaning: keep the freeform rect) when there's no text
   *  under the drag at all, or it spans multiple lines, where a single
   *  rectangle union would sweep up an unrelated horizontal band between
   *  the lines.
   *
   *  The union isn't purely tight, though: pdf.js's per-word measurement
   *  (see lib/textLayerWords.ts) can undershoot a word's true trailing edge
   *  — worst for the last word of a long/bold heading — which would leave a
   *  sliver of the word visibly poking out past a tightly-snapped box. So
   *  each edge grows toward wherever the user's own raw drag reached, capped
   *  at the nearest word the drag DIDN'T match — close enough to catch that
   *  overshoot without ever bleeding into text that wasn't touched. */
  const wordSnappedBox = (rect: DraftRect): DraftRect | null => {
    const container = textLayerContainer.current
    const svgRect = svgRef.current?.getBoundingClientRect()
    if (!container || !svgRect || svgRect.width === 0 || svgRect.height === 0) return null
    const dragClientRect = localToClientRect(rect, svgRect)
    const hits = wordsIntersecting(container, dragClientRect, spanFontNames.current)
    if (hits.length === 0) return null
    const lines = groupByLine(hits)
    if (lines.length !== 1) return null
    const matched = lines[0]
    const isMatched = (w: WordHit) => matched.some((m) => m.text === w.text && m.rect.left === w.rect.left)

    const tightLeft = Math.min(...matched.map((h) => h.rect.left))
    const tightRight = Math.max(...matched.map((h) => h.rect.right))
    let leftBoundary = -Infinity
    let rightBoundary = Infinity
    for (const w of allWordHits(container, spanFontNames.current)) {
      if (Math.abs(w.rect.bottom - matched[0].rect.bottom) >= 8 || isMatched(w)) continue
      if (w.rect.right <= tightLeft) leftBoundary = Math.max(leftBoundary, w.rect.right)
      if (w.rect.left >= tightRight) rightBoundary = Math.min(rightBoundary, w.rect.left)
    }

    const clientLeft = Math.max(Math.min(dragClientRect.left, tightLeft), leftBoundary)
    const clientRight = Math.min(Math.max(dragClientRect.right, tightRight), rightBoundary)
    const clientTop = Math.min(...matched.map((h) => h.rect.top))
    const clientBottom = Math.max(...matched.map((h) => h.rect.bottom))
    const local = clientToLocalRect(
      new DOMRect(clientLeft, clientTop, clientRight - clientLeft, clientBottom - clientTop),
      svgRect,
    )
    const x = local.x - WORD_PADDING
    const y = local.y - WORD_PADDING
    const right = local.x + local.width + WORD_PADDING
    const bottom = local.y + local.height + WORD_PADDING
    return {
      x: clamp(x, 0, geometry.width),
      y: clamp(y, 0, geometry.height),
      width: clamp(right, 0, geometry.width) - clamp(x, 0, geometry.width),
      height: clamp(bottom, 0, geometry.height) - clamp(y, 0, geometry.height),
    }
  }

  // ----- drawing a new box --------------------------------------------------
  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'redact' || !e.isPrimary) return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const pt = toLocal(e)
    drawRef.current = {
      pointerId: e.pointerId,
      startX: pt.x,
      startY: pt.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
    }
    setDraft({ x: pt.x, y: pt.y, width: 0, height: 0 })
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawRef.current
    if (tool !== 'redact' || !d || e.pointerId !== d.pointerId) return
    const pt = toLocal(e)
    const next = {
      x: Math.min(d.startX, pt.x),
      y: Math.min(d.startY, pt.y),
      width: Math.abs(pt.x - d.startX),
      height: Math.abs(pt.y - d.startY),
    }
    setDraft(next)
    updatePreview(next)
  }

  const finishDraw = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drawRef.current
    if (!d || e.pointerId !== d.pointerId) return
    drawRef.current = null
    const rect = draft
    setDraft(null)
    setPreview(null)
    if (!rect) return

    if (rect.width < CLICK_THRESHOLD && rect.height < CLICK_THRESHOLD) {
      // A tap/click with no meaningful drag: snap to the exact word under
      // the cursor, if any — otherwise fall back to a default-sized box
      // centered on the click point (e.g. for redacting part of an image).
      const container = textLayerContainer.current
      const hit = container ? wordAtPoint(container, d.startClientX, d.startClientY, spanFontNames.current) : null
      if (hit) {
        const svgRect = svgRef.current!.getBoundingClientRect()
        const word = clientToLocalRect(hit.rect, svgRect)
        const x = clamp(word.x - WORD_PADDING, 0, geometry.width)
        const y = clamp(word.y - WORD_PADDING, 0, geometry.height)
        onCommitBox({
          x,
          y,
          width: clamp(word.x + word.width + WORD_PADDING, 0, geometry.width) - x,
          height: clamp(word.y + word.height + WORD_PADDING, 0, geometry.height) - y,
        })
        return
      }
      const width = Math.min(DEFAULT_BOX_WIDTH, geometry.width)
      const height = Math.min(DEFAULT_BOX_HEIGHT, geometry.height)
      onCommitBox({
        x: clamp(d.startX - width / 2, 0, geometry.width - width),
        y: clamp(d.startY - height / 2, 0, geometry.height - height),
        width,
        height,
      })
      return
    }
    if (rect.width < MIN_BOX_SIZE || rect.height < MIN_BOX_SIZE) return
    onCommitBox(wordSnappedBox(rect) ?? rect)
  }

  // ----- selecting & moving --------------------------------------------------
  const startMove = (box: RedactionBox) => (e: ReactPointerEvent<SVGElement>) => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    moveRef.current = { pointerId: e.pointerId, id: box.id, lastClientX: e.clientX, lastClientY: e.clientY, box }
    onSelect(box.id)
    updatePreview(box)
  }

  const handleMovePointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const m = moveRef.current
    if (!m || e.pointerId !== m.pointerId) return
    const rect = svgRef.current!.getBoundingClientRect()
    const rawDx = ((e.clientX - m.lastClientX) / rect.width) * geometry.width
    const rawDy = ((e.clientY - m.lastClientY) / rect.height) * geometry.height
    m.lastClientX = e.clientX
    m.lastClientY = e.clientY
    const dx = clamp(rawDx, -m.box.x, geometry.width - (m.box.x + m.box.width))
    const dy = clamp(rawDy, -m.box.y, geometry.height - (m.box.y + m.box.height))
    if (dx === 0 && dy === 0) return
    m.box = { ...m.box, x: m.box.x + dx, y: m.box.y + dy }
    onMove(m.id, dx, dy)
    updatePreview(m.box)
  }

  const endMove = (e: ReactPointerEvent<SVGElement>) => {
    const m = moveRef.current
    if (m && e.pointerId === m.pointerId) moveRef.current = null
    setPreview(null)
  }

  // ----- resizing via the corner handle --------------------------------------
  const startResize = (box: RedactionBox) => (e: ReactPointerEvent<SVGElement>) => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = { pointerId: e.pointerId, id: box.id, box }
    onSelect(box.id)
    updatePreview(box)
  }

  const handleResizePointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const r = resizeRef.current
    if (!r || e.pointerId !== r.pointerId) return
    const pt = toLocal(e)
    const width = clamp(pt.x - r.box.x, MIN_BOX_SIZE, geometry.width - r.box.x)
    const height = clamp(pt.y - r.box.y, MIN_BOX_SIZE, geometry.height - r.box.y)
    onResize(r.id, width, height)
    updatePreview({ x: r.box.x, y: r.box.y, width, height })
  }

  const endResize = (e: ReactPointerEvent<SVGElement>) => {
    const r = resizeRef.current
    if (r && e.pointerId === r.pointerId) resizeRef.current = null
    setPreview(null)
  }

  const drawing = tool === 'redact'
  const selecting = tool === 'select'
  const selectedBox = selectedId ? redactions.find((r) => r.id === selectedId) : undefined
  const activeRect = draft ?? (moveRef.current?.box ?? resizeRef.current?.box)

  return (
    <svg
      ref={svgRef}
      data-layer="redact"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full ${
        drawing ? 'z-30 cursor-crosshair touch-none' : 'pointer-events-none z-[15]'
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDraw}
      onPointerCancel={finishDraw}
    >
      {/* Live preview of what a box-in-progress will catch, painted first
          (bottom) so the box itself and its handles stay on top. */}
      {preview?.map((item, i) => (
        <rect
          key={i}
          x={item.rect.x}
          y={item.rect.y}
          width={item.rect.width}
          height={item.rect.height}
          fill="#f59e0b"
          opacity={0.35}
          pointerEvents="none"
        />
      ))}
      {redactions.map((r) => (
        <rect
          key={r.id}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill="#000000"
          className={selecting ? 'cursor-move touch-none' : undefined}
          style={selecting ? { pointerEvents: 'all' } : undefined}
          onPointerDown={selecting ? startMove(r) : undefined}
          onPointerMove={selecting ? handleMovePointerMove : undefined}
          onPointerUp={selecting ? endMove : undefined}
          onPointerCancel={selecting ? endMove : undefined}
        />
      ))}
      {draft && (
        <rect x={draft.x} y={draft.y} width={draft.width} height={draft.height} fill="#000000" opacity={0.85} />
      )}
      {preview && activeRect && (
        <foreignObject
          x={clamp(activeRect.x, 0, Math.max(0, geometry.width - 260))}
          y={Math.max(0, activeRect.y - 30)}
          width={260}
          height={28}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div className="inline-block max-w-[260px] rounded-md bg-slate-900 px-2 py-1 text-[11px] leading-tight text-white shadow-lg">
            {!preciseRedactionPossible
              ? 'This page will be fully flattened to an image (contains an image or is rotated)'
              : preview.length === 0
                ? 'No text under this box'
                : `Redacting: ${preview.map((p) => p.text).join(' ')}`}
          </div>
        </foreignObject>
      )}
      {selecting && selectedBox && (
        <>
          <rect
            x={selectedBox.x - 3}
            y={selectedBox.y - 3}
            width={selectedBox.width + 6}
            height={selectedBox.height + 6}
            fill="none"
            stroke="#f43f5e"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
          {/* Corner resize handle: drag to grow/shrink the box freely. */}
          <rect
            x={selectedBox.x + selectedBox.width - 1}
            y={selectedBox.y + selectedBox.height - 1}
            width={12}
            height={12}
            rx={2}
            fill="#f43f5e"
            stroke="#ffffff"
            strokeWidth={1.5}
            className="touch-none"
            style={{ pointerEvents: 'all', cursor: 'nwse-resize' }}
            onPointerDown={startResize(selectedBox)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          {/* Delete button, offset above the top-right corner — the only way
              to remove a redaction on touch devices (no keyboard Delete). */}
          <g
            transform={`translate(${selectedBox.x + selectedBox.width - 2}, ${selectedBox.y - 22})`}
            className="cursor-pointer touch-none"
            style={{ pointerEvents: 'all' }}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDelete(selectedBox.id)
            }}
          >
            <rect x={-16} y={0} width={18} height={18} rx={4} fill="#f43f5e" />
            <TrashIcon x={-13} y={3} width={12} height={12} stroke="#ffffff" />
          </g>
        </>
      )}
    </svg>
  )
}
