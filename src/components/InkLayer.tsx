import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PageGeometry, Point, Stroke, Tool } from '../types'
import { clamp } from '../lib/coords'
import { strokeToSvgPath } from '../lib/smoothing'

interface InkLayerProps {
  geometry: PageGeometry
  strokes: Stroke[]
  tool: Tool
  penColor: string
  penWidth: number
  /** Currently selected stroke group key (groupId or stroke id). */
  selectedKey: string | null
  onCommitStroke: (points: Point[]) => void
  onEraseStroke: (id: string) => void
  onSelectStrokes: (key: string | null) => void
  onMoveStrokes: (key: string, dx: number, dy: number) => void
  onScaleStrokes: (key: string, factor: number, originX: number, originY: number) => void
}

/** Ignore pointer jitter below this distance (in PDF points, ~0.9 px at 100%). */
const MIN_POINT_DISTANCE = 0.7

interface Bbox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function strokesBbox(strokes: Stroke[]): Bbox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

/**
 * SVG overlay that captures freehand strokes. The viewBox is in displayed
 * page units (PDF points), so stored stroke coordinates are zoom-independent
 * and the browser handles all scaling for us.
 *
 * In select mode, strokes become clickable: a stamped signature's strokes
 * share a groupId, so grabbing any part selects and drags the whole
 * signature as one piece; hand-drawn strokes move individually.
 */
export function InkLayer({
  geometry,
  strokes,
  tool,
  penColor,
  penWidth,
  selectedKey,
  onCommitStroke,
  onEraseStroke,
  onSelectStrokes,
  onMoveStrokes,
  onScaleStrokes,
}: InkLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Point[] | null>(null)
  const draftRef = useRef<Point[] | null>(null) // avoids stale closures during fast moves
  const moveRef = useRef<{
    pointerId: number
    key: string
    lastClientX: number
    lastClientY: number
    bbox: Bbox
  } | null>(null)
  const resizeRef = useRef<{
    pointerId: number
    key: string
    /** Scale origin: the corner opposite the drag handle (frame top-left). */
    originX: number
    originY: number
    /** Pointer distance from origin at the previous move, in page units. */
    lastDist: number
    bbox: Bbox
  } | null>(null)

  const toLocal = (e: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * geometry.width, 0, geometry.width),
      y: clamp(((e.clientY - rect.top) / rect.height) * geometry.height, 0, geometry.height),
    }
  }

  // ----- drawing -----------------------------------------------------------
  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'draw' || !e.isPrimary) return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const start = [toLocal(e)]
    draftRef.current = start
    setDraft(start)
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const current = draftRef.current
    if (tool !== 'draw' || !current) return
    const pt = toLocal(e)
    const last = current[current.length - 1]
    if (Math.hypot(pt.x - last.x, pt.y - last.y) < MIN_POINT_DISTANCE) return
    const next = [...current, pt]
    draftRef.current = next
    setDraft(next)
  }

  const finishStroke = () => {
    const current = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (current && current.length > 0) onCommitStroke(current)
  }

  // ----- selecting & moving (select tool) ----------------------------------
  const startMove = (key: string) => (e: ReactPointerEvent<SVGElement>) => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.stopPropagation() // keep the page's deselect handler out of it
    const group = strokes.filter((s) => s.groupId === key || s.id === key)
    const bbox = strokesBbox(group)
    if (!bbox) return
    e.currentTarget.setPointerCapture(e.pointerId)
    moveRef.current = {
      pointerId: e.pointerId,
      key,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      bbox,
    }
    onSelectStrokes(key)
  }

  const handleMovePointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const m = moveRef.current
    if (!m || e.pointerId !== m.pointerId) return
    const rect = svgRef.current!.getBoundingClientRect()
    const rawDx = ((e.clientX - m.lastClientX) / rect.width) * geometry.width
    const rawDy = ((e.clientY - m.lastClientY) / rect.height) * geometry.height
    m.lastClientX = e.clientX
    m.lastClientY = e.clientY
    // Keep the whole group on the page.
    const dx = clamp(rawDx, -m.bbox.minX, geometry.width - m.bbox.maxX)
    const dy = clamp(rawDy, -m.bbox.minY, geometry.height - m.bbox.maxY)
    if (dx === 0 && dy === 0) return
    m.bbox = { minX: m.bbox.minX + dx, minY: m.bbox.minY + dy, maxX: m.bbox.maxX + dx, maxY: m.bbox.maxY + dy }
    onMoveStrokes(m.key, dx, dy)
  }

  const endMove = (e: ReactPointerEvent<SVGElement>) => {
    const m = moveRef.current
    if (m && e.pointerId === m.pointerId) moveRef.current = null
  }

  // ----- resizing via the corner handle -------------------------------------
  const startResize = (key: string) => (e: ReactPointerEvent<SVGElement>) => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.stopPropagation()
    const group = strokes.filter((s) => s.groupId === key || s.id === key)
    const bbox = strokesBbox(group)
    if (!bbox) return
    const pt = toLocal(e)
    const lastDist = Math.hypot(pt.x - bbox.minX, pt.y - bbox.minY)
    if (lastDist < 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = {
      pointerId: e.pointerId,
      key,
      originX: bbox.minX,
      originY: bbox.minY,
      lastDist,
      bbox,
    }
    // Re-selecting resets undo coalescing, making each resize drag one step.
    onSelectStrokes(key)
  }

  const handleResizePointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const r = resizeRef.current
    if (!r || e.pointerId !== r.pointerId) return
    const pt = toLocal(e)
    const dist = Math.hypot(pt.x - r.originX, pt.y - r.originY)
    if (dist < 1) return
    let factor = dist / r.lastDist
    // Clamp: keep the group at least ~12pt across and fully on the page.
    const w = r.bbox.maxX - r.originX
    const h = r.bbox.maxY - r.originY
    const maxFactor = Math.min(
      (geometry.width - r.originX) / w,
      (geometry.height - r.originY) / h,
    )
    const minFactor = 12 / Math.max(w, h)
    factor = clamp(factor, minFactor, maxFactor)
    if (Math.abs(factor - 1) < 0.005) return
    r.bbox = {
      minX: r.originX,
      minY: r.originY,
      maxX: r.originX + w * factor,
      maxY: r.originY + h * factor,
    }
    r.lastDist = dist
    onScaleStrokes(r.key, factor, r.originX, r.originY)
  }

  const endResize = (e: ReactPointerEvent<SVGElement>) => {
    const r = resizeRef.current
    if (r && e.pointerId === r.pointerId) resizeRef.current = null
  }

  const drawing = tool === 'draw'
  const erasing = tool === 'erase'
  const selecting = tool === 'select'

  const selectedStrokes = selectedKey
    ? strokes.filter((s) => s.groupId === selectedKey || s.id === selectedKey)
    : []
  const selectionBbox = selecting && selectedStrokes.length > 0 ? strokesBbox(selectedStrokes) : null

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full ${
        drawing ? 'z-20 cursor-crosshair touch-none' : 'pointer-events-none z-[5]'
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    >
      {selectionBbox && (
        <>
          {/* Dashed frame around the selected signature/stroke; draggable too. */}
          <rect
            x={selectionBbox.minX - 6}
            y={selectionBbox.minY - 6}
            width={selectionBbox.maxX - selectionBbox.minX + 12}
            height={selectionBbox.maxY - selectionBbox.minY + 12}
            fill="rgba(14,165,233,0.06)"
            stroke="#0ea5e9"
            strokeWidth={1}
            strokeDasharray="5 4"
            className="cursor-move touch-none"
            style={{ pointerEvents: 'all' }}
            onPointerDown={startMove(selectedKey!)}
            onPointerMove={handleMovePointerMove}
            onPointerUp={endMove}
            onPointerCancel={endMove}
          />
          {/* Corner resize handle: drag away from / toward the opposite
              corner to grow/shrink the whole signature uniformly. */}
          <rect
            x={selectionBbox.maxX - 1}
            y={selectionBbox.maxY - 1}
            width={12}
            height={12}
            rx={2}
            fill="#0ea5e9"
            stroke="#ffffff"
            strokeWidth={1.5}
            className="touch-none"
            style={{ pointerEvents: 'all', cursor: 'nwse-resize' }}
            onPointerDown={startResize(selectedKey!)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        </>
      )}
      {strokes.map((s) => {
        const d = strokeToSvgPath(s.points)
        const key = s.groupId ?? s.id
        return (
          <g key={s.id}>
            <path
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {(erasing || selecting) && (
              // Fat invisible twin: easy to hit with mouse or finger.
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(s.width, 12)}
                strokeLinecap="round"
                className={erasing ? 'cursor-pointer' : 'cursor-move touch-none'}
                style={{ pointerEvents: 'stroke' }}
                onPointerDown={
                  erasing
                    ? (e) => {
                        e.stopPropagation()
                        onEraseStroke(s.id)
                      }
                    : startMove(key)
                }
                onPointerMove={selecting ? handleMovePointerMove : undefined}
                onPointerUp={selecting ? endMove : undefined}
                onPointerCancel={selecting ? endMove : undefined}
                onPointerEnter={
                  erasing
                    ? (e) => {
                        // Drag across strokes with the button held to erase them.
                        if (e.buttons > 0) onEraseStroke(s.id)
                      }
                    : undefined
                }
              />
            )}
          </g>
        )
      })}
      {draft && (
        <path
          d={strokeToSvgPath(draft)}
          fill="none"
          stroke={penColor}
          strokeWidth={penWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
