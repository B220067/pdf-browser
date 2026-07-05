import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { strokeToSvgPath } from '../lib/smoothing'
import { clamp } from '../lib/coords'
import type { Point, SignatureTemplate } from '../types'
import { SIGNATURE_TEMPLATE_HEIGHT, SIGNATURE_TEMPLATE_WIDTH } from '../types'
import { ColorSwatches } from './ColorSwatches'
import { TrashIcon } from './icons'

interface SignatureCaptureProps {
  penColor: string
  penWidth: number
  onSave: (signature: SignatureTemplate) => void
  onCancel: () => void
}

/** Ignore pointer jitter, same rationale as InkLayer's MIN_POINT_DISTANCE. */
const MIN_POINT_DISTANCE = 0.7
/** CSS pixel size of the capture box — bigger than the template's PDF-point
 * size (viewBox) for comfortable drawing precision; the SVG scales it down. */
const DISPLAY_WIDTH = SIGNATURE_TEMPLATE_WIDTH * 2

/**
 * Standalone signature capture, deliberately separate from the on-page
 * InkLayer: it draws into its own fixed-size template space, not onto any
 * particular page, so there's no ambiguity about which on-page stroke "is"
 * the signature once saved.
 */
export function SignatureCapture({ penColor, penWidth, onSave, onCancel }: SignatureCaptureProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [draft, setDraft] = useState<Point[] | null>(null)
  const draftRef = useRef<Point[] | null>(null)
  const [inkColor, setInkColor] = useState(penColor)

  const toLocal = (e: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: clamp(
        ((e.clientX - rect.left) / rect.width) * SIGNATURE_TEMPLATE_WIDTH,
        0,
        SIGNATURE_TEMPLATE_WIDTH,
      ),
      y: clamp(
        ((e.clientY - rect.top) / rect.height) * SIGNATURE_TEMPLATE_HEIGHT,
        0,
        SIGNATURE_TEMPLATE_HEIGHT,
      ),
    }
  }

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const start = [toLocal(e)]
    draftRef.current = start
    setDraft(start)
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const current = draftRef.current
    if (!current) return
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
    if (current && current.length > 0) setStrokes((prev) => [...prev, current])
  }

  const handleClear = () => {
    setStrokes([])
    setDraft(null)
    draftRef.current = null
  }

  const handleSave = () => {
    if (strokes.length === 0) return
    onSave({ strokes: strokes.map((points) => ({ points, width: penWidth, color: inkColor })) })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-capture-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 id="signature-capture-title" className="text-lg font-semibold text-slate-900">
          Draw your signature
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Draw once here, then stamp it on as many pages as you need.
        </p>

        <div
          className="mx-auto mt-4 touch-none rounded-lg border-2 border-dashed border-slate-300 bg-slate-50"
          style={{ width: DISPLAY_WIDTH, maxWidth: '100%' }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SIGNATURE_TEMPLATE_WIDTH} ${SIGNATURE_TEMPLATE_HEIGHT}`}
            preserveAspectRatio="none"
            className="block h-auto w-full cursor-crosshair touch-none"
            style={{ aspectRatio: `${SIGNATURE_TEMPLATE_WIDTH} / ${SIGNATURE_TEMPLATE_HEIGHT}` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
          >
            {strokes.map((points, i) => (
              <path
                key={i}
                d={strokeToSvgPath(points)}
                fill="none"
                stroke={inkColor}
                strokeWidth={penWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {draft && (
              <path
                d={strokeToSvgPath(draft)}
                fill="none"
                stroke={inkColor}
                strokeWidth={penWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          Ink
          <ColorSwatches value={inkColor} onChange={setInkColor} ariaLabel="Signature ink color" />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            title="Clear"
            onClick={handleClear}
            disabled={strokes.length === 0 && !draft}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
          >
            <TrashIcon />
            Clear
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={strokes.length === 0}
              className="rounded-lg bg-sky-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save signature
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
