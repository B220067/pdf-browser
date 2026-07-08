import { useEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { RenderingCancelledException } from 'pdfjs-dist'
import type { HistoryAction } from '../lib/editorState'
import { effectiveGeometry } from '../lib/coords'
import type { PageEntry, PageGeometry } from '../types'
import { RotateIcon, TrashIcon, CloseIcon } from './icons'

const THUMB_WIDTH = 80

interface MobilePageDrawerProps {
  open: boolean
  pages: PDFPageProxy[]
  geometries: PageGeometry[]
  pageOrder: PageEntry[]
  dispatch: Dispatch<HistoryAction>
  onClose: () => void
  onNavigateToPage: (originalIndex: number) => void
}

function Thumbnail({
  page,
  rotationDelta,
  width,
  height,
}: {
  page: PDFPageProxy
  rotationDelta: 0 | 90 | 180 | 270
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = THUMB_WIDTH / width
    const viewport = page.getViewport({
      scale: scale * 2,
      rotation: (page.rotate + rotationDelta) % 360,
    })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    task.promise.catch((err: unknown) => {
      if (!(err instanceof RenderingCancelledException)) console.error(err)
    })
    return () => task.cancel()
  }, [page, rotationDelta, width])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none block bg-white"
      style={{ width: THUMB_WIDTH, height: (height / width) * THUMB_WIDTH }}
      aria-hidden
    />
  )
}

export function MobilePageDrawer({
  open,
  pages,
  geometries,
  pageOrder,
  dispatch,
  onClose,
  onNavigateToPage,
}: MobilePageDrawerProps) {
  const itemRefs = useRef(new Map<number, HTMLDivElement>())
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const dragRef = useRef<{ pointerId: number; from: number; over: number } | null>(null)

  const indexUnderPointer = (clientY: number): number => {
    let best = pageOrder.length - 1
    for (let i = 0; i < pageOrder.length; i++) {
      const el = itemRefs.current.get(i)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) {
        best = i
        break
      }
    }
    return best
  }

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, from: index, over: index }
    setDrag({ from: index, over: index })
  }

  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const over = indexUnderPointer(e.clientY)
    if (over !== d.over) {
      d.over = over
      setDrag({ from: d.from, over })
    }
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (d.from !== d.over) {
      dispatch({ type: 'REORDER_PAGES', from: d.from, to: d.over })
    } else {
      // Released back where it started — this was a tap, not a drag, so
      // jump the main view to this page (the caller also closes the drawer).
      onNavigateToPage(pageOrder[d.from].originalIndex)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-h-96 flex flex-col gap-3 rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Pages</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <CloseIcon width={20} height={20} />
          </button>
        </div>
        <div className="overflow-y-auto flex flex-col gap-2">
          {pageOrder.map((entry, index) => {
            const base = geometries[entry.originalIndex]
            const geom = effectiveGeometry(base, entry.rotationDelta)
            const isDragging = drag?.from === index
            const isDropTarget = drag !== null && drag.over === index && drag.from !== index
            return (
              <div
                key={entry.originalIndex}
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el)
                  else itemRefs.current.delete(index)
                }}
                className={`group relative touch-none flex items-center gap-2 rounded-lg border p-2 transition-colors ${
                  isDragging
                    ? 'border-sky-400 bg-sky-50 opacity-60'
                    : isDropTarget
                      ? 'border-sky-500 bg-sky-100'
                      : 'border-slate-200 bg-white hover:border-sky-300'
                }`}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return
                  startDrag(e, index)
                }}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className="text-xs font-medium text-slate-500 w-8 text-center">{index + 1}</span>
                <div className="cursor-grab overflow-hidden rounded border border-slate-100">
                  <Thumbnail
                    page={pages[entry.originalIndex]}
                    rotationDelta={entry.rotationDelta}
                    width={geom.width}
                    height={geom.height}
                  />
                </div>
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    title="Rotate page 90° clockwise"
                    onClick={() =>
                      dispatch({
                        type: 'ROTATE_PAGE',
                        originalIndex: entry.originalIndex,
                        baseGeometry: base,
                      })
                    }
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600"
                  >
                    <RotateIcon width={14} height={14} />
                  </button>
                  <button
                    type="button"
                    title={pageOrder.length === 1 ? 'Cannot delete the last page' : 'Delete page'}
                    disabled={pageOrder.length === 1}
                    onClick={() =>
                      dispatch({ type: 'DELETE_PAGE', originalIndex: entry.originalIndex })
                    }
                    className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
