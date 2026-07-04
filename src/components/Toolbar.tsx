import type { Dispatch } from 'react'
import type { EditorAction } from '../lib/editorState'
import type { Tool } from '../types'
import {
  CloseIcon,
  CursorIcon,
  DownloadIcon,
  EraserIcon,
  MinusIcon,
  PenIcon,
  PlusIcon,
  TypeIcon,
  UndoIcon,
} from './icons'

interface ToolbarProps {
  fileName: string
  tool: Tool
  penColor: string
  penWidth: number
  canUndoStroke: boolean
  zoom: number
  saving: boolean
  dispatch: Dispatch<EditorAction>
  onZoom: (factor: number) => void
  onDownload: () => void
  onClose: () => void
}

const TOOLS: { tool: Tool; label: string; shortcut: string; Icon: typeof CursorIcon }[] = [
  { tool: 'select', label: 'Select & move', shortcut: 'V', Icon: CursorIcon },
  { tool: 'text', label: 'Add text box', shortcut: 'T', Icon: TypeIcon },
  { tool: 'draw', label: 'Draw / sign', shortcut: 'D', Icon: PenIcon },
  { tool: 'erase', label: 'Erase strokes', shortcut: 'E', Icon: EraserIcon },
]

const PEN_WIDTHS = [1, 2, 3, 5, 8]

export function Toolbar({
  fileName,
  tool,
  penColor,
  penWidth,
  canUndoStroke,
  zoom,
  saving,
  dispatch,
  onZoom,
  onDownload,
  onClose,
}: ToolbarProps) {
  return (
    <header className="z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xl font-bold tracking-tight text-slate-900">
          Ink<span className="text-sky-500">PDF</span>
        </span>
        <span className="hidden max-w-48 truncate text-sm text-slate-500 sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1.5" role="toolbar" aria-label="Tools">
        {TOOLS.map(({ tool: t, label, shortcut, Icon }) => (
          <button
            key={t}
            type="button"
            title={`${label} (${shortcut})`}
            aria-pressed={tool === t}
            onClick={() => dispatch({ type: 'SET_TOOL', tool: t })}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2.5 text-base font-medium transition-colors ${
              tool === t
                ? 'bg-white text-sky-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon width={22} height={22} strokeWidth={2} />
            <span className="hidden sm:inline">{label.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {(tool === 'draw' || tool === 'erase') && (
        <div className="flex items-center gap-3 rounded-lg bg-slate-100 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            Color
            <input
              type="color"
              value={penColor}
              onChange={(e) => dispatch({ type: 'SET_PEN', color: e.target.value })}
              className="h-8 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              aria-label="Pen color"
            />
          </label>
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Pen width">
            {PEN_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={penWidth === w}
                title={`${w} pt`}
                onClick={() => dispatch({ type: 'SET_PEN', width: w })}
                className={`flex h-9 w-9 items-center justify-center rounded-md ${
                  penWidth === w ? 'bg-white shadow-sm ring-1 ring-sky-400' : 'hover:bg-slate-200'
                }`}
              >
                <span
                  className="rounded-full bg-slate-700"
                  style={{ width: Math.max(w * 1.8, 4), height: Math.max(w * 1.8, 4) }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          title="Undo last stroke (Ctrl+Z)"
          disabled={!canUndoStroke}
          onClick={() => dispatch({ type: 'UNDO_STROKE' })}
          className="rounded-md p-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
        >
          <UndoIcon width={22} height={22} />
        </button>

        <div className="flex items-center rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            title="Zoom out"
            onClick={() => onZoom(1 / 1.2)}
            className="rounded-md p-2 text-slate-600 hover:bg-white hover:shadow-sm"
          >
            <MinusIcon width={20} height={20} />
          </button>
          <button
            type="button"
            title="Reset zoom to fit width"
            onClick={() => onZoom(0)}
            className="w-14 text-center text-sm font-medium tabular-nums text-slate-600"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            title="Zoom in"
            onClick={() => onZoom(1.2)}
            className="rounded-md p-2 text-slate-600 hover:bg-white hover:shadow-sm"
          >
            <PlusIcon width={20} height={20} />
          </button>
        </div>

        <button
          type="button"
          onClick={onDownload}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-600 disabled:cursor-wait disabled:opacity-60"
        >
          <DownloadIcon width={20} height={20} />
          {saving ? 'Saving…' : 'Download'}
        </button>

        <button
          type="button"
          title="Close this file"
          onClick={onClose}
          className="rounded-md p-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <CloseIcon width={22} height={22} />
        </button>
      </div>
    </header>
  )
}
