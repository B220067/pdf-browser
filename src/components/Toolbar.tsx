import type { Dispatch } from 'react'
import type { HistoryAction } from '../lib/editorState'
import type { Tool } from '../types'
import { ColorSwatches } from './ColorSwatches'
import {
  CloseIcon,
  CursorIcon,
  DownloadIcon,
  EraserIcon,
  MinusIcon,
  PenIcon,
  PlusIcon,
  RedoIcon,
  SignatureIcon,
  TypeIcon,
  UndoIcon,
} from './icons'

interface ToolbarProps {
  fileName: string
  tool: Tool
  penColor: string
  penWidth: number
  canUndo: boolean
  canRedo: boolean
  hasSavedSignature: boolean
  zoom: number
  saving: boolean
  dispatch: Dispatch<HistoryAction>
  onZoom: (factor: number) => void
  onDownload: () => void
  onClose: () => void
  onSignatureClick: () => void
  onRedrawSignature: () => void
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
  canUndo,
  canRedo,
  hasSavedSignature,
  zoom,
  saving,
  dispatch,
  onZoom,
  onDownload,
  onClose,
  onSignatureClick,
  onRedrawSignature,
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

      <div className="flex items-center gap-1">
        <button
          type="button"
          title={hasSavedSignature ? 'Stamp your saved signature' : 'Draw a signature to reuse'}
          aria-pressed={tool === 'stamp'}
          onClick={onSignatureClick}
          className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-base font-medium transition-colors ${
            tool === 'stamp'
              ? 'bg-sky-100 text-sky-700'
              : 'bg-slate-100 text-slate-600 hover:text-slate-900'
          }`}
        >
          <SignatureIcon width={22} height={22} />
          <span className="hidden sm:inline">Signature</span>
        </button>
        {hasSavedSignature && (
          <button
            type="button"
            title="Draw a new signature to replace the saved one"
            onClick={onRedrawSignature}
            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            <PenIcon width={16} height={16} />
            Redraw
          </button>
        )}
      </div>

      {(tool === 'draw' || tool === 'erase') && (
        <div className="flex items-center gap-3 rounded-lg bg-slate-100 px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            Color
            <ColorSwatches
              value={penColor}
              onChange={(color) => dispatch({ type: 'SET_PEN', color })}
              ariaLabel="Pen color"
            />
          </div>
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
                  // A pure w*1.8 scale floors both 1pt (1.8px) and 2pt
                  // (3.6px) to the same 4px minimum, making the two smallest
                  // sizes look identical. Adding a flat offset keeps every
                  // step visibly distinct while still scaling with width.
                  className="rounded-full bg-slate-700"
                  style={{ width: w * 2 + 3, height: w * 2 + 3 }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => dispatch({ type: 'UNDO' })}
          className="rounded-md p-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
        >
          <UndoIcon width={22} height={22} />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={() => dispatch({ type: 'REDO' })}
          className="rounded-md p-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
        >
          <RedoIcon width={22} height={22} />
        </button>

        <div className="flex items-center rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            title="Zoom out"
            onClick={() => onZoom(1 / 1.4)}
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
            onClick={() => onZoom(1.4)}
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
