import { useEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { RenderingCancelledException } from 'pdfjs-dist'
import type { EditorAction, EditorState } from '../lib/editorState'
import { clamp, clientToDisplayed } from '../lib/coords'
import type { PageGeometry, Point } from '../types'
import { LINE_HEIGHT } from '../types'
import { InkLayer } from './InkLayer'
import { TextBoxItem } from './TextBoxItem'

interface PdfPageProps {
  page: PDFPageProxy
  geometry: PageGeometry
  scale: number
  state: EditorState
  dispatch: Dispatch<EditorAction>
}

/** Cap the backing-store resolution so huge pages on HiDPI screens don't OOM. */
const MAX_DPR = 2

export function PdfPage({ page, geometry, scale, state, dispatch }: PdfPageProps) {
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
    const viewport = page.getViewport({ scale: scale * dpr })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    task.promise.catch((err: unknown) => {
      if (!(err instanceof RenderingCancelledException)) {
        console.error(`Failed to render page ${geometry.pageIndex + 1}`, err)
      }
    })
    return () => task.cancel()
  }, [page, scale, nearViewport, geometry.pageIndex])

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
          fontFamily: 'Helvetica',
          color: '#111827',
        },
      })
    } else if (state.tool === 'select') {
      // Clicking bare page area (text boxes stop propagation) deselects.
      dispatch({ type: 'SELECT_TEXT', id: null })
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
          state.tool === 'text' ? 'cursor-text' : ''
        }`}
        style={{ width: geometry.width * scale, height: geometry.height * scale }}
        onPointerDown={handlePagePointerDown}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

        <InkLayer
          geometry={geometry}
          strokes={pageStrokes}
          tool={state.tool}
          penColor={state.penColor}
          penWidth={state.penWidth}
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
      <span className="text-xs text-slate-400 select-none">Page {geometry.pageIndex + 1}</span>
    </div>
  )
}
