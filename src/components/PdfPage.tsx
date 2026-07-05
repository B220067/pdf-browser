import { useEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { RenderingCancelledException } from 'pdfjs-dist'
import type { EditorState, HistoryAction } from '../lib/editorState'
import { clamp, clientToDisplayed } from '../lib/coords'
import type { FormWidget, PageGeometry, Point, Stroke } from '../types'
import { LINE_HEIGHT, SIGNATURE_TEMPLATE_HEIGHT, SIGNATURE_TEMPLATE_WIDTH } from '../types'
import { FormFieldOverlay } from './FormFieldOverlay'
import { InkLayer } from './InkLayer'
import { TextBoxItem } from './TextBoxItem'

interface PdfPageProps {
  page: PDFPageProxy
  /** EFFECTIVE geometry — already includes any user-applied rotation delta. */
  geometry: PageGeometry
  /** Extra user rotation, applied on top of the page's own /Rotate. */
  rotationDelta: 0 | 90 | 180 | 270
  /** Position in the current page arrangement (for the "Page n" label). */
  displayIndex: number
  /** AcroForm widgets on this page (original-index filtered by the parent). */
  formWidgets: FormWidget[]
  scale: number
  state: EditorState
  dispatch: Dispatch<HistoryAction>
}

/** Cap the backing-store resolution so huge pages on HiDPI screens don't OOM. */
const MAX_DPR = 2

export function PdfPage({
  page,
  geometry,
  rotationDelta,
  displayIndex,
  formWidgets,
  scale,
  state,
  dispatch,
}: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Lazy rendering: pages render their canvas once they approach the viewport
  // and stay rendered, so long documents load fast and scrolling stays smooth.
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
      { rootMargin: '150% 0%' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!nearViewport) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    // pdf.js renders the user's extra rotation natively — no CSS transform,
    // so pointer math and overlays keep working on rotated pages.
    const viewport = page.getViewport({
      scale: scale * dpr,
      rotation: (page.rotate + rotationDelta) % 360,
    })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    task.promise.catch((err: unknown) => {
      if (!(err instanceof RenderingCancelledException)) {
        console.error(`Failed to render page ${geometry.pageIndex + 1}`, err)
      }
    })
    return () => task.cancel()
  }, [page, scale, nearViewport, geometry.pageIndex, rotationDelta])

  const handlePagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return
    if (state.tool === 'text') {
      // Cancel the default so the browser's follow-up mousedown (which
      // hit-tests the canvas, not the box we're about to create) doesn't
      // steal focus from the new textarea.
      e.preventDefault()
      const rect = wrapperRef.current!.getBoundingClientRect()
      const pt: Point = clientToDisplayed(e.clientX, e.clientY, rect, geometry)
      const fontSize = 16
      dispatch({
        type: 'ADD_TEXT',
        element: {
          id: crypto.randomUUID(),
          pageIndex: geometry.pageIndex,
          // Center the first line roughly on the click point.
          x: clamp(pt.x, 0, geometry.width - 40),
          y: clamp(pt.y - (fontSize * LINE_HEIGHT) / 2, 0, geometry.height - fontSize * LINE_HEIGHT),
          text: '',
          fontSize,
          fontFamily: 'Arial',
          color: '#111827',
        },
      })
    } else if (state.tool === 'select') {
      // Clicking bare page area (overlays stop propagation) deselects.
      dispatch({ type: 'SELECT_TEXT', id: null })
      dispatch({ type: 'SELECT_STROKES', key: null })
    } else if (state.tool === 'stamp' && state.savedSignature) {
      const rect = wrapperRef.current!.getBoundingClientRect()
      const click = clientToDisplayed(e.clientX, e.clientY, rect, geometry)
      // Center the saved template on the click point.
      const offsetX = click.x - SIGNATURE_TEMPLATE_WIDTH / 2
      const offsetY = click.y - SIGNATURE_TEMPLATE_HEIGHT / 2
      // One groupId for every stroke in this stamp: selecting any part of
      // the signature later selects (and moves) the whole thing as one.
      const groupId = crypto.randomUUID()
      const strokes: Stroke[] = state.savedSignature.strokes.map((s) => ({
        id: crypto.randomUUID(),
        pageIndex: geometry.pageIndex,
        points: s.points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
        width: s.width,
        color: s.color,
        groupId,
      }))
      dispatch({ type: 'STAMP_SIGNATURE', strokes })
    }
  }

  const pageTexts = state.texts.filter((t) => t.pageIndex === geometry.pageIndex)
  const pageStrokes = state.strokes.filter((s) => s.pageIndex === geometry.pageIndex)

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={wrapperRef}
        data-page={geometry.pageIndex}
        className={`relative bg-white shadow-md ring-1 ring-black/10 ${
          state.tool === 'text' || state.tool === 'stamp' ? 'cursor-text' : ''
        } ${
          // touch-action on the <svg> ink layer alone isn't reliably honored
          // on all mobile browsers (notably Safari) — setting it here too,
          // on an ancestor <div>, is what actually stops the page from
          // scrolling out from under a touch-drawn or touch-erased stroke.
          state.tool === 'draw' || state.tool === 'erase' ? 'touch-none' : ''
        }`}
        style={{ width: geometry.width * scale, height: geometry.height * scale }}
        onPointerDown={handlePagePointerDown}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

        {formWidgets.length > 0 && (
          <FormFieldOverlay
            widgets={formWidgets}
            values={state.formFieldValues}
            geometry={geometry}
            scale={scale}
            dispatch={dispatch}
          />
        )}

        <InkLayer
          geometry={geometry}
          strokes={pageStrokes}
          tool={state.tool}
          penColor={state.penColor}
          penWidth={state.penWidth}
          selectedKey={state.selectedStrokeKey}
          onSelectStrokes={(key) => dispatch({ type: 'SELECT_STROKES', key })}
          onMoveStrokes={(key, dx, dy) => dispatch({ type: 'MOVE_STROKES', key, dx, dy })}
          onScaleStrokes={(key, factor, originX, originY) =>
            dispatch({ type: 'SCALE_STROKES', key, factor, originX, originY })
          }
          onCommitStroke={(points) =>
            dispatch({
              type: 'ADD_STROKE',
              stroke: {
                id: crypto.randomUUID(),
                pageIndex: geometry.pageIndex,
                points,
                width: state.penWidth,
                color: state.penColor,
              },
            })
          }
          onEraseStroke={(id) => dispatch({ type: 'REMOVE_STROKE', id })}
        />

        {pageTexts.map((el) => (
          <TextBoxItem
            key={el.id}
            el={el}
            geometry={geometry}
            scale={scale}
            selected={state.selectedTextId === el.id}
            dispatch={dispatch}
          />
        ))}
      </div>
      <span className="text-xs text-slate-400 select-none">Page {displayIndex + 1}</span>
    </div>
  )
}
