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
import { RedactLayer } from './RedactLayer'
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
  /** Whether this page paints any image — mirrors savePdf.ts's own check, so
   *  the redact tool can preview live whether a box will get word-level
   *  removal or fall back to flattening the whole page. */
  hasImages: boolean
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
  hasImages,
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
      // The commonAncestorContainer check above already guarantees these
      // rects belong to THIS page, so just drop degenerate zero-size ones —
      // don't clamp surviving rects to pageRect's own box. That clamp used
      // to be load-bearing (the old cross-page bug relied on it to avoid
      // drawing rects that belonged to a completely different page), but
      // now it only ever hurts: any rect a sub-pixel wider than the
      // computed pageRect (a common rounding mismatch between a container's
      // layout box and its rendered glyphs) got its far edge chopped off,
      // which is exactly why highlights were cutting off a character or two
      // before the actual end of a selection.
      let usable = rects.filter((r) => r.width > 2 && r.height > 2)

      if (usable.length === 0) return

      // Chrome's getClientRects() can report TWO rects for the very same
      // span here — identical left/right, but one a few px inset top/bottom
      // from the other (an inner "glyph ink" box vs. an outer "line box";
      // observed on this text layer's absolutely-positioned, custom
      // line-height spans). Collapse duplicates sharing a horizontal span
      // into one union rect before grouping by line, or the two variants'
      // slightly different tops can land on opposite sides of the line-
      // grouping tolerance below and get treated as separate lines.
      const byHorizontalSpan = new Map<string, DOMRect[]>()
      for (const r of usable) {
        const key = `${Math.round(r.left)}:${Math.round(r.right)}`
        const group = byHorizontalSpan.get(key)
        if (group) group.push(r)
        else byHorizontalSpan.set(key, [r])
      }
      usable = [...byHorizontalSpan.values()].map((group) => {
        if (group.length === 1) return group[0]
        const top = Math.min(...group.map((r) => r.top))
        const bottom = Math.max(...group.map((r) => r.bottom))
        return new DOMRect(group[0].left, top, group[0].width, bottom - top)
      })

      // A single visual line can still produce MULTIPLE separate rects here:
      // pdf.js gives mixed-weight runs (e.g. bold numbers inline in a
      // regular-weight paragraph) their own text items, since it only merges
      // adjacent same-styled runs into one span. Left un-merged, each span
      // got its own independently-padded stroke — at every boundary between
      // a regular-weight span and an adjacent bold one, two (sometimes
      // three) semi-transparent strokes overlapped, visibly darkening
      // exactly the bold text a highlight crossed. Group rects by line and
      // merge each group into one bounding rect so a line gets exactly one
      // stroke regardless of how many differently-styled spans it's made of.
      //
      // Group by BOTTOM, not top. Measured directly: a rect touching either
      // end of the selection Range (vs. one fully enclosed in the middle)
      // can get a noticeably different top/height even within the SAME
      // line and same run of text — up to ~5px in testing — which a
      // top-tolerance comparison can't distinguish from a genuinely
      // different, closely-spaced next line. Bottoms stayed consistent
      // within a line in the same test (≤~5px apart) while differing
      // clearly between lines (20px+), so they're the more reliable anchor.
      const LINE_TOLERANCE = 8 // CSS px
      const byLine: DOMRect[][] = []
      for (const r of [...usable].sort((a, b) => a.bottom - b.bottom)) {
        const line = byLine.find((group) => Math.abs(group[0].bottom - r.bottom) < LINE_TOLERANCE)
        if (line) line.push(r)
        else byLine.push([r])
      }
      const mergedLines = byLine.map((group) => {
        const left = Math.min(...group.map((r) => r.left))
        const right = Math.max(...group.map((r) => r.right))
        const top = Math.min(...group.map((r) => r.top))
        const bottom = Math.max(...group.map((r) => r.bottom))
        return { left, right, top, bottom, height: bottom - top }
      })

      // pdf.js's text layer is an invisible APPROXIMATION built for
      // selection/search, not a pixel-exact copy of the rendered glyphs: it
      // measures each span using a generic fallback font (confirmed via
      // inspection — spans render with computed font-weight 400 even when
      // the PDF's actual font is bold) and stretches it to the PDF's true
      // text width via a single per-span `--scale-x` transform. That works
      // for most text, but under-corrects for bold/styled runs, leaving the
      // selectable area a little short of where the glyphs actually render —
      // confirmed the START edge lines up with the canvas within a pixel, so
      // the shortfall is at the END only. Pad the trailing edge by roughly
      // one character's width (approximated from the rect's own height/line
      // size, not its length — a whole-line-length-proportional pad
      // overshoot badly on long lines) and the leading edge only a little
      // (rounding/antialiasing, not measurement drift).
      const START_PAD = 2 // CSS px
      const endPad = (rect: { height: number }) => rect.height * 1.1

      for (const rect of mergedLines) {
        const x1 = (rect.left - START_PAD - pageRect.left) / scale
        const y1 = (rect.top - pageRect.top) / scale
        const x2 = (rect.right + endPad(rect) - pageRect.left) / scale
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
      dispatch({ type: 'SELECT_REDACTION', id: null })
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
  const pageRedactions = state.redactions.filter((r) => r.pageIndex === geometry.pageIndex)

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
          state.tool === 'draw' || state.tool === 'erase' || state.tool === 'redact' ? 'touch-none' : ''
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

        <RedactLayer
          geometry={geometry}
          redactions={pageRedactions}
          tool={state.tool}
          selectedId={state.selectedRedactionId}
          textLayerContainer={textLayerRef}
          preciseRedactionPossible={geometry.rotation === 0 && !hasImages}
          onSelect={(id) => dispatch({ type: 'SELECT_REDACTION', id })}
          onMove={(id, dx, dy) => dispatch({ type: 'MOVE_REDACTION', id, dx, dy })}
          onResize={(id, width, height) => dispatch({ type: 'RESIZE_REDACTION', id, width, height })}
          onDelete={(id) => dispatch({ type: 'REMOVE_REDACTION', id })}
          onCommitBox={(rect) =>
            dispatch({
              type: 'ADD_REDACTION',
              box: { id: crypto.randomUUID(), pageIndex: geometry.pageIndex, ...rect },
            })
          }
        />
      </div>
      <span className="text-xs text-slate-400 select-none">Page {displayIndex + 1}</span>
    </div>
  )
}
