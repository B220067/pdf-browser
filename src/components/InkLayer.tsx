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
  onCommitStroke: (points: Point[]) => void
  onEraseStroke: (id: string) => void
}

/** Ignore pointer jitter below this distance (in PDF points, ~0.9 px at 100%). */
const MIN_POINT_DISTANCE = 0.7

/**
 * SVG overlay that captures freehand strokes. The viewBox is in displayed
 * page units (PDF points), so stored stroke coordinates are zoom-independent
 * and the browser handles all scaling for us.
 */
export function InkLayer({
  geometry,
  strokes,
  tool,
  penColor,
  penWidth,
  onCommitStroke,
  onEraseStroke,
}: InkLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Point[] | null>(null)
  const draftRef = useRef<Point[] | null>(null) // avoids stale closures during fast moves

  const toLocal = (e: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * geometry.width, 0, geometry.width),
      y: clamp(((e.clientY - rect.top) / rect.height) * geometry.height, 0, geometry.height),
    }
  }

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

  const interactive = tool === 'draw'
  const erasing = tool === 'erase'

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full ${
        interactive ? 'z-20 cursor-crosshair touch-none' : 'pointer-events-none z-[5]'
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    >
      {strokes.map((s) => {
        const d = strokeToSvgPath(s.points)
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
            {erasing && (
              // Fat invisible twin so thin strokes are easy to hit.
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(s.width, 10)}
                strokeLinecap="round"
                className="cursor-pointer hover:stroke-red-300/60"
                style={{ pointerEvents: 'stroke' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onEraseStroke(s.id)
                }}
                onPointerEnter={(e) => {
                  // Drag across strokes with the button held to erase them.
                  if (e.buttons > 0) onEraseStroke(s.id)
                }}
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
