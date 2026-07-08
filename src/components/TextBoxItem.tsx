import { useLayoutEffect, useRef } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { EditorAction } from '../lib/editorState'
import { clamp } from '../lib/coords'
import type { PageGeometry, TextElement } from '../types'
import { FONT_CSS_STACKS, FONT_LABELS, FONT_FAMILIES, FONT_SIZES, LINE_HEIGHT } from '../types'
import { ColorSwatches } from './ColorSwatches'
import {
  BoldIcon,
  GripIcon,
  ItalicIcon,
  TrashIcon,
  UnderlineIcon,
} from './icons'

interface TextBoxItemProps {
  el: TextElement
  geometry: PageGeometry
  scale: number
  selected: boolean
  dispatch: Dispatch<EditorAction>
}

/**
 * Visual padding (screen px) around the textarea that doubles as the drag
 * zone. Needs to be wide enough for a finger, not just a mouse cursor — an
 * 8px ring is unreachable by touch (a finger reliably lands on the textarea
 * instead, which intentionally excludes itself from dragging so normal text
 * cursor placement still works).
 */
const DRAG_RING = 18

export function TextBoxItem({ el, geometry, scale, selected, dispatch }: TextBoxItemProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const drag = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  // Auto-size the textarea to its content (wrap="off": explicit newlines only,
  // matching how the text will be drawn into the PDF).
  useLayoutEffect(() => {
    const ta = areaRef.current
    if (!ta) return
    ta.style.width = '0px'
    ta.style.height = '0px'
    ta.style.width = `${Math.max(ta.scrollWidth + 4, 40 * scale)}px`
    ta.style.height = `${Math.max(ta.scrollHeight, el.fontSize * LINE_HEIGHT * scale)}px`
  }, [el.text, el.fontSize, el.fontFamily, scale])

  // Freshly added (still empty) boxes grab focus so the user can type at
  // once. Focus synchronously (the creating pointerdown is defaultPrevented,
  // so the trailing mousedown won't blur us), with a deferred retry as a
  // backstop in case another handler in the click sequence steals focus.
  useLayoutEffect(() => {
    if (!selected || el.text !== '') return
    areaRef.current?.focus()
    const timer = window.setTimeout(() => {
      if (document.activeElement !== areaRef.current) areaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selected, el.text])

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return
    // Let clicks inside the textarea behave like normal text editing.
    if (e.target === areaRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: el.x,
      originY: el.y,
      moved: false,
    }
    dispatch({ type: 'SELECT_TEXT', id: el.id })
  }

  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = (e.clientX - d.startClientX) / scale
    const dy = (e.clientY - d.startClientY) / scale
    if (!d.moved && Math.hypot(dx * scale, dy * scale) < 3) return
    d.moved = true
    dispatch({
      type: 'UPDATE_TEXT',
      id: el.id,
      patch: {
        x: clamp(d.originX + dx, -20, geometry.width - 20),
        y: clamp(d.originY + dy, 0, geometry.height - el.fontSize * LINE_HEIGHT),
      },
    })
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    if (!d.moved) {
      // Plain click on the ring: focus the text for editing.
      areaRef.current?.focus()
    }
  }

  return (
    <div
      // touch-none: without it, dragging a text box on a touchscreen gets
      // read as a page-scroll gesture instead of a move — preventDefault()
      // on the pointer event alone doesn't stop that on mobile.
      className="absolute z-10 touch-none"
      style={{ left: el.x * scale - DRAG_RING, top: el.y * scale - DRAG_RING }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={() => (drag.current = null)}
    >
      {selected && (
        <div
          className="absolute top-full left-0 mt-2 flex flex-col gap-1 rounded-lg bg-slate-900 px-1.5 py-1 text-white shadow-lg"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Row 1: move handle + font family */}
          <div className="flex items-center gap-1">
            <span
              title="Drag to move"
              className="touch-none cursor-move rounded p-2 text-slate-400 hover:text-white"
              onPointerDown={(e) => {
                e.stopPropagation()
                startDragFromGrip(e)
              }}
            >
              <GripIcon width={20} height={20} />
            </span>
            <select
              value={el.fontFamily}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_TEXT',
                  id: el.id,
                  patch: { fontFamily: e.target.value as TextElement['fontFamily'] },
                })
              }
              className="min-w-0 flex-1 rounded bg-slate-800 px-1 py-0.5 text-xs outline-none"
              aria-label="Font family"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {FONT_LABELS[f]}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2: colors + font size */}
          <div className="flex items-center gap-1">
            <ColorSwatches
              value={el.color}
              onChange={(color) => dispatch({ type: 'UPDATE_TEXT', id: el.id, patch: { color } })}
              size="compact"
              ariaLabel="Text color"
            />
            <select
              value={el.fontSize}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_TEXT',
                  id: el.id,
                  patch: { fontSize: Number(e.target.value) },
                })
              }
              className="rounded bg-slate-800 py-0.5 pl-1 pr-2 text-xs outline-none"
              aria-label="Font size"
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Row 3: bold/italic/underline + delete */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Bold"
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_TEXT',
                    id: el.id,
                    patch: { bold: !el.bold },
                  })
                }
                className={`rounded p-1.5 transition-colors ${
                  el.bold
                    ? 'bg-sky-500 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <BoldIcon width={16} height={16} />
              </button>
              <button
                type="button"
                title="Italic"
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_TEXT',
                    id: el.id,
                    patch: { italic: !el.italic },
                  })
                }
                className={`rounded p-1.5 transition-colors ${
                  el.italic
                    ? 'bg-sky-500 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <ItalicIcon width={16} height={16} />
              </button>
              <button
                type="button"
                title="Underline"
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_TEXT',
                    id: el.id,
                    patch: { underline: !el.underline },
                  })
                }
                className={`rounded p-1.5 transition-colors ${
                  el.underline
                    ? 'bg-sky-500 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <UnderlineIcon width={16} height={16} />
              </button>
            </div>
            <button
              type="button"
              title="Delete text box"
              onClick={() => dispatch({ type: 'REMOVE_TEXT', id: el.id })}
              className="rounded p-1 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      )}

      <div
        data-textbox
        className={`cursor-move rounded-sm transition-shadow ${
          selected
            ? 'ring-2 ring-sky-500'
            : 'ring-1 ring-transparent hover:ring-sky-300'
        }`}
        style={{ padding: DRAG_RING }}
      >
        <textarea
          ref={areaRef}
          value={el.text}
          placeholder="Type…"
          wrap="off"
          rows={1}
          spellCheck={false}
          onFocus={() => dispatch({ type: 'SELECT_TEXT', id: el.id })}
          onChange={(e) =>
            dispatch({ type: 'UPDATE_TEXT', id: el.id, patch: { text: e.target.value } })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className="block cursor-text resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-slate-400/70"
          style={{
            fontSize: el.fontSize * scale,
            lineHeight: LINE_HEIGHT,
            fontFamily: FONT_CSS_STACKS[el.fontFamily],
            color: el.color,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            textDecoration: el.underline ? 'underline' : 'none',
          }}
        />
      </div>
    </div>
  )

  // Grip drags reuse the same pointer-capture machinery as the ring.
  function startDragFromGrip(e: ReactPointerEvent<HTMLElement>) {
    if (!e.isPrimary) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const origin = { x: el.x, y: el.y }
    const start = { x: e.clientX, y: e.clientY }
    const target = e.currentTarget

    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      dispatch({
        type: 'UPDATE_TEXT',
        id: el.id,
        patch: {
          x: clamp(origin.x + (ev.clientX - start.x) / scale, -20, geometry.width - 20),
          y: clamp(
            origin.y + (ev.clientY - start.y) / scale,
            0,
            geometry.height - el.fontSize * LINE_HEIGHT,
          ),
        },
      })
    }
    const onUp = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }
}
