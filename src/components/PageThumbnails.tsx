import { useEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { RenderingCancelledException } from 'pdfjs-dist'
import type { HistoryAction } from '../lib/editorState'
import { effectiveGeometry } from '../lib/coords'
import type { PageEntry, PageGeometry } from '../types'
import { RotateIcon, TrashIcon } from './icons'

const THUMB_WIDTH = 96

interface PageThumbnailsProps {
  pages: PDFPageProxy[]
  geometries: PageGeometry[]
  pageOrder: PageEntry[]
  dispatch: Dispatch<HistoryAction>
  onNavigateToPage: (originalIndex: number) => void
}

function Thumbnail({
  page,
  rotationDelta,
  width,
  height,
  scrollRootRef,
}: {
  page: PDFPageProxy
  rotationDelta: 0 | 90 | 180 | 270
  width: number
  height: number
  /** The sidebar's own scroll container — IntersectionObserver needs this as
   * `root` since these thumbnails scroll within the sidebar, not the window. */
  scrollRootRef: RefObject<HTMLElement | null>
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Windowed rendering: with hundreds of pages, rendering every thumbnail
  // canvas up front on load causes a real, noticeable freeze. Only render
  // once a thumbnail is about to scroll into view, same lazy pattern PdfPage
  // already uses for the main page canvases.
  const [nearViewport, setNearViewport] = useState(false)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearViewport(true)
          observer.disconnect()
        }
      },
      { root: scrollRootRef.current, rootMargin: '150% 0%' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRootRef])

  useEffect(() => {
    if (!nearViewport) return
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = THUMB_WIDTH / width
    const viewport = page.getViewport({
      scale: scale * 2, // 2x for crispness at thumbnail size
      rotation: (page.rotate + rotationDelta) % 360,
    })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    task.promise.catch((err: unknown) => {
      if (!(err instanceof RenderingCancelledException)) console.error(err)
    })
    return () => task.cancel()
  }, [page, rotationDelta, width, nearViewport])

  const displayHeight = (height / width) * THUMB_WIDTH

  return (
    <div ref={wrapperRef} style={{ width: THUMB_WIDTH, height: displayHeight }} className="bg-white">
      {nearViewport && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none block"
          style={{ width: THUMB_WIDTH, height: displayHeight }}
          aria-hidden
        />
      )}
    </div>
  )
}

/**
 * Sidebar with one draggable thumbnail per page: drag to reorder, plus
 * rotate/delete buttons. Reordering uses the same pointer-capture pattern
 * as TextBoxItem's drag — no drag-and-drop library.
 */
export function PageThumbnails({
  pages,
  geometries,
  pageOrder,
  dispatch,
  onNavigateToPage,
}: PageThumbnailsProps) {
  const itemRefs = useRef(new Map<number, HTMLDivElement>())
  const scrollRootRef = useRef<HTMLElement | null>(null)
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
      // Released back where it started — this was a click/tap, not a drag,
      // so jump the main view to this page instead of doing nothing.
      onNavigateToPage(pageOrder[d.from].originalIndex)
    }
  }

  return (
    <aside
      ref={(el) => {
        scrollRootRef.current = el
      }}
      className="hidden w-40 shrink-0 overflow-y-auto border-r border-slate-300 bg-slate-100 p-3 md:block"
    >
      <div className="flex flex-col gap-3">
        {pageOrder.map((entry, index) => {
          const base = geometries[entry.originalIndex]
          const geom = effectiveGeometry(base, entry.rotationDelta)
          const isDragging = drag?.from === index
          const isDropTarget = drag !== null && drag.over === index && drag.from !== index
          const thumbHeight = (geom.height / geom.width) * THUMB_WIDTH

          return (
            <div key={entry.originalIndex}>
              {/* Visible placeholder at the drop target to clearly indicate
                  where the dragged page will land. */}
              {isDropTarget && (
                <div
                  className="mb-2 flex items-center justify-center rounded border-2 border-dashed border-sky-500 bg-sky-50/30"
                  style={{ width: THUMB_WIDTH, height: thumbHeight }}
                />
              )}

              <div
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el)
                  else itemRefs.current.delete(index)
                }}
                className={`group relative touch-none rounded-lg border p-1.5 transition-all duration-150 ease-out transform-gpu ${
                  isDragging
                    ? 'opacity-30 scale-95'
                    : 'border-slate-200 bg-white hover:border-sky-300'
                } ${isDropTarget ? 'ring-2 ring-sky-200' : ''}`}
                onPointerDown={(e) => {
                  // Buttons handle their own clicks; everywhere else starts a drag.
                  if ((e.target as HTMLElement).closest('button')) return
                  startDrag(e, index)
                }}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <div className="cursor-grab overflow-hidden rounded border border-slate-100">
                  <Thumbnail
                    page={pages[entry.originalIndex]}
                    rotationDelta={entry.rotationDelta}
                    width={geom.width}
                    height={geom.height}
                    scrollRootRef={scrollRootRef}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="pl-1 text-xs font-medium text-slate-500">{index + 1}</span>
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
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
