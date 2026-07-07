import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import { RenderingCancelledException, TextLayer } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
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
  const textLayerRef = useRef<HTMLDivElement>(null)
  const textLayerTaskRef = useRef<TextLayer | null>(null)
  // Lazy rendering: pages render their canvas once they approach the viewport
  // and stay rendered, so long documents load fast and scrolling stays smooth.
  const [nearViewport, setNearViewport] = useState(false)
  useEffect(() => {
    if (state.tool !== 'highlight') return
    const handleTextSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.toString().length === 0) return

      // Get the selection bounding boxes
      const range = selection.getRangeAt(0)

      // This listener is registered on `document` once per rendered page, so
      // every page's instance fires on any mouseup, anywhere. Only the page
      // that actually contains the selection should do anything — otherwise
      // the empty-after-clipping fallback below would (and did) draw bogus,
      // wrongly-scaled strokes using a different page's coordinate frame.
      const pageEl = wrapperRef.current
      if (!pageEl || !pageEl.contains(range.commonAncestorContainer)) return

      let rects = Array.from(range.getClientRects())
      // If getClientRects returned nothing (some browsers/edge cases),
      // fall back to the single bounding rect.
      if (rects.length === 0) {
        const r = range.getBoundingClientRect()
        if (r && r.width > 0 && r.height > 0) rects = [r]
      }
      if (rects.length === 0) return

      const pageRect = pageEl.getBoundingClientRect()

      // Create highlight strokes for each selection rect, but commit them in
      // one batch so a single selection is one undo step.
      const strokes: Stroke[] = []
      const groupId = crypto.randomUUID()
      // Filter rects to those that overlap the page area (avoid handles/UI)
      const usable = rects
        .map((r) => ({
          left: Math.max(r.left, pageRect.left),
          top: Math.max(r.top, pageRect.top),
          right: Math.min(r.right, pageRect.right),
          bottom: Math.min(r.bottom, pageRect.bottom),
        }))
        .filter((r) => r.right - r.left > 2 && r.bottom - r.top > 2)

      // Nothing survived clipping to this page — genuinely nothing to
      // highlight here. Do NOT fall back to the raw/unclipped rects; they
      // may belong to a different page's screen position entirely.
      if (usable.length === 0) return

      for (const rect of usable) {
        const x1 = (rect.left - pageRect.left) / scale
        const y1 = (rect.top - pageRect.top) / scale
        const x2 = (rect.right - pageRect.left) / scale
        const y2 = (rect.bottom - pageRect.top) / scale

        // Create a thin highlight stroke along the text. Use the vertical
        // center of the rect so it lines up with text baseline/center.
        const stroke: Stroke = {
          id: crypto.randomUUID(),
          pageIndex: geometry.pageIndex,
          points: [
            { x: x1, y: (y1 + y2) / 2 },
            { x: x2, y: (y1 + y2) / 2 },
          ],
          width: Math.max(2, (y2 - y1) * 0.9), // height-based width
          color: state.penColor,
          opacity: 0.4,
          groupId,
        }
        strokes.push(stroke)
      }

      if (strokes.length > 0) {
        dispatch({ type: 'ADD_STROKES', strokes })
      }
      
      // Clear selection
      selection.removeAllRanges()
    }
    
    document.addEventListener('mouseup', handleTextSelection)
    return () => document.removeEventListener('mouseup', handleTextSelection)
  }, [state.tool, state.penColor, geometry.pageIndex, scale])

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

  // Render PDF text content into the text layer for selection. We transform
  // each page's text content using pdf.js's own TextLayer renderer, which
  // applies the same ascent, width scaling, and rotation math as the viewer.
  useEffect(() => {
    if (!nearViewport || !textLayerRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const textContent = await page.getTextContent()
        if (cancelled || !textLayerRef.current) return

        const viewport = page.getViewport({
          scale,
          rotation: (page.rotate + rotationDelta) % 360,
        })
        textLayerTaskRef.current?.cancel()
        textLayerTaskRef.current = new TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport,
        })
        textLayerRef.current!.innerHTML = ''
        await textLayerTaskRef.current.render()
      } catch {
        // Ignore errors if text extraction fails
      }
    })()
    return () => {
      cancelled = true
      textLayerTaskRef.current?.cancel()
      textLayerTaskRef.current = null
    }
  }, [page, nearViewport, rotationDelta, scale])

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
        
        {/* Text layer for selection (especially for highlighter tool) */}
        <div
          ref={textLayerRef}
          className={`textLayer absolute inset-0 h-full w-full select-text ${
            state.tool === 'highlight' ? 'cursor-text' : 'pointer-events-none'
          }`}
          style={
            {
              fontSize: 0,
              color: 'transparent',
              userSelect: 'text',
              // pdf.js's own TextLayer CSS sizes each span via
              // `calc(var(--text-scale-factor) * var(--font-height))`, which
              // in turn depends on --total-scale-factor. The official pdf.js
              // viewer chrome normally sets this custom property; since this
              // app renders pages itself, nothing else sets it — leaving it
              // empty, which makes the whole calc() chain invalid and
              // silently falls back to the fontSize:0 above, collapsing
              // every span to zero size. Set it directly to the same CSS
              // scale used to build this layer's own viewport.
              '--total-scale-factor': scale,
            } as CSSProperties
          }
        />

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
                opacity: state.tool === 'highlight' ? 0.4 : 1,
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
