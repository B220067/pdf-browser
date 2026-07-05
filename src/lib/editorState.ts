import type {
  FormFieldValue,
  PageEntry,
  PageGeometry,
  Point,
  SignatureTemplate,
  Stroke,
  TextElement,
  Tool,
} from '../types'
import { displayedToPdf, effectiveGeometry, pdfToDisplayed } from './coords'

export interface EditorState {
  tool: Tool
  texts: TextElement[]
  strokes: Stroke[]
  selectedTextId: string | null
  /** groupId (stamped signature) or stroke id (hand-drawn) of the selected ink. */
  selectedStrokeKey: string | null
  penColor: string
  penWidth: number
  /** Session-only — drawn once in the signature modal, stamped repeatedly. */
  savedSignature: SignatureTemplate | null
  /** Current page arrangement; empty until INIT_PAGES fires after doc load. */
  pageOrder: PageEntry[]
  /** AcroForm field values keyed by field name; seeded by INIT_FIELDS. */
  formFieldValues: Record<string, FormFieldValue>
}

export const initialEditorState: EditorState = {
  tool: 'select',
  texts: [],
  strokes: [],
  selectedTextId: null,
  selectedStrokeKey: null,
  penColor: '#1d4ed8',
  penWidth: 2,
  savedSignature: null,
  pageOrder: [],
  formFieldValues: {},
}

export type EditorAction =
  | { type: 'SET_TOOL'; tool: Tool }
  | { type: 'ADD_TEXT'; element: TextElement }
  | { type: 'UPDATE_TEXT'; id: string; patch: Partial<Omit<TextElement, 'id' | 'pageIndex'>> }
  | { type: 'REMOVE_TEXT'; id: string }
  | { type: 'SELECT_TEXT'; id: string | null }
  | { type: 'ADD_STROKE'; stroke: Stroke }
  | { type: 'REMOVE_STROKE'; id: string }
  | { type: 'SELECT_STROKES'; key: string | null }
  | { type: 'MOVE_STROKES'; key: string; dx: number; dy: number }
  | { type: 'SCALE_STROKES'; key: string; factor: number; originX: number; originY: number }
  | { type: 'REMOVE_STROKES'; key: string }
  | { type: 'SET_PEN'; color?: string; width?: number }
  | { type: 'SET_SAVED_SIGNATURE'; signature: SignatureTemplate | null }
  | { type: 'STAMP_SIGNATURE'; strokes: Stroke[] }
  | { type: 'INIT_PAGES'; count: number }
  | { type: 'DELETE_PAGE'; originalIndex: number }
  | { type: 'ROTATE_PAGE'; originalIndex: number; baseGeometry: PageGeometry }
  | { type: 'REORDER_PAGES'; from: number; to: number }
  | { type: 'INIT_FIELDS'; values: Record<string, FormFieldValue> }
  | { type: 'SET_FIELD_VALUE'; name: string; value: FormFieldValue }

/** A stroke belongs to a selection key by group (stamp) or by its own id. */
const strokeMatches = (s: Stroke, key: string): boolean => s.groupId === key || s.id === key

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_TOOL':
      return {
        ...state,
        tool: action.tool,
        selectedTextId: action.tool === 'select' ? state.selectedTextId : null,
        selectedStrokeKey: action.tool === 'select' ? state.selectedStrokeKey : null,
      }
    case 'ADD_TEXT':
      // Adding a box drops you straight into editing it with the select tool.
      return {
        ...state,
        texts: [...state.texts, action.element],
        selectedTextId: action.element.id,
        selectedStrokeKey: null,
        tool: 'select',
      }
    case 'UPDATE_TEXT':
      return {
        ...state,
        texts: state.texts.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      }
    case 'REMOVE_TEXT':
      return {
        ...state,
        texts: state.texts.filter((t) => t.id !== action.id),
        selectedTextId: state.selectedTextId === action.id ? null : state.selectedTextId,
      }
    case 'SELECT_TEXT':
      return {
        ...state,
        selectedTextId: action.id,
        selectedStrokeKey: action.id === null ? state.selectedStrokeKey : null,
      }
    case 'ADD_STROKE':
      return { ...state, strokes: [...state.strokes, action.stroke] }
    case 'REMOVE_STROKE':
      return { ...state, strokes: state.strokes.filter((s) => s.id !== action.id) }
    case 'SELECT_STROKES':
      return {
        ...state,
        selectedStrokeKey: action.key,
        selectedTextId: action.key === null ? state.selectedTextId : null,
      }
    case 'MOVE_STROKES':
      return {
        ...state,
        strokes: state.strokes.map((s) =>
          strokeMatches(s, action.key)
            ? { ...s, points: s.points.map((p) => ({ x: p.x + action.dx, y: p.y + action.dy })) }
            : s,
        ),
      }
    case 'SCALE_STROKES': {
      // Uniform scale about a fixed origin (the selection frame's opposite
      // corner). Stroke width scales along so a resized signature looks like
      // the same signature drawn bigger/smaller, not a thin/fat variant.
      const { factor, originX, originY } = action
      return {
        ...state,
        strokes: state.strokes.map((s) =>
          strokeMatches(s, action.key)
            ? {
                ...s,
                width: s.width * factor,
                points: s.points.map((p) => ({
                  x: originX + (p.x - originX) * factor,
                  y: originY + (p.y - originY) * factor,
                })),
              }
            : s,
        ),
      }
    }
    case 'REMOVE_STROKES':
      return {
        ...state,
        strokes: state.strokes.filter((s) => !strokeMatches(s, action.key)),
        selectedStrokeKey:
          state.selectedStrokeKey === action.key ? null : state.selectedStrokeKey,
      }
    case 'SET_PEN':
      return {
        ...state,
        penColor: action.color ?? state.penColor,
        penWidth: action.width ?? state.penWidth,
      }
    case 'SET_SAVED_SIGNATURE':
      return { ...state, savedSignature: action.signature }
    case 'STAMP_SIGNATURE':
      // All strokes from one stamp land in a single undo step (see
      // CONTENT_ACTIONS below), even though a signature is usually several
      // strokes (dot on an "i", crossed "t", etc).
      return { ...state, strokes: [...state.strokes, ...action.strokes] }
    case 'INIT_PAGES':
      return {
        ...state,
        pageOrder: Array.from({ length: action.count }, (_, i) => ({
          originalIndex: i,
          rotationDelta: 0,
        })),
      }
    case 'DELETE_PAGE':
      if (state.pageOrder.length <= 1) return state
      return {
        ...state,
        pageOrder: state.pageOrder.filter((p) => p.originalIndex !== action.originalIndex),
      }
    case 'ROTATE_PAGE': {
      const entry = state.pageOrder.find((p) => p.originalIndex === action.originalIndex)
      if (!entry) return state
      const newDelta = ((entry.rotationDelta + 90) % 360) as PageEntry['rotationDelta']
      // Stored element coordinates live in "displayed page space", which
      // changes orientation when the page rotates. Round-trip every point
      // through structural PDF space (which is rotation-invariant) so
      // existing text/strokes stay pinned to the same spot on the paper.
      const gOld = effectiveGeometry(action.baseGeometry, entry.rotationDelta)
      const gNew = effectiveGeometry(action.baseGeometry, newDelta)
      const remap = (pt: Point): Point => pdfToDisplayed(displayedToPdf(pt, gOld), gNew)
      return {
        ...state,
        pageOrder: state.pageOrder.map((p) =>
          p.originalIndex === action.originalIndex ? { ...p, rotationDelta: newDelta } : p,
        ),
        texts: state.texts.map((t) =>
          t.pageIndex === action.originalIndex ? { ...t, ...remap({ x: t.x, y: t.y }) } : t,
        ),
        strokes: state.strokes.map((s) =>
          s.pageIndex === action.originalIndex ? { ...s, points: s.points.map(remap) } : s,
        ),
      }
    }
    case 'REORDER_PAGES': {
      const { from, to } = action
      if (from === to || from < 0 || to < 0 || from >= state.pageOrder.length || to >= state.pageOrder.length) {
        return state
      }
      const next = [...state.pageOrder]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...state, pageOrder: next }
    }
    case 'INIT_FIELDS':
      return { ...state, formFieldValues: action.values }
    case 'SET_FIELD_VALUE':
      return {
        ...state,
        formFieldValues: { ...state.formFieldValues, [action.name]: action.value },
      }
  }
}

/**
 * Undo/redo wraps EditorState rather than tracking per-action inverses —
 * simpler to get right, and the state is small enough that snapshotting is
 * cheap. Only "content" actions create a checkpoint; tool/selection/pen
 * changes are transient UI state, not something a user expects Ctrl+Z to
 * step through.
 */
export interface HistoryState {
  past: EditorState[]
  present: EditorState
  future: EditorState[]
  /**
   * Identifies which element the most recent snapshot was taken for, so a
   * burst of UPDATE_TEXT dispatches to the SAME element (every keystroke
   * while typing, every frame while dragging) coalesces into one undo step
   * instead of one per keystroke. Not itself part of undo/redo.
   */
  coalesceKey: string | null
}

export const initialHistoryState: HistoryState = {
  past: [],
  present: initialEditorState,
  future: [],
  coalesceKey: null,
}

const MAX_HISTORY = 50

const CONTENT_ACTIONS = new Set<EditorAction['type']>([
  'ADD_TEXT',
  'REMOVE_TEXT',
  'UPDATE_TEXT',
  'ADD_STROKE',
  'REMOVE_STROKE',
  'MOVE_STROKES',
  'SCALE_STROKES',
  'REMOVE_STROKES',
  'STAMP_SIGNATURE',
  'DELETE_PAGE',
  'ROTATE_PAGE',
  'REORDER_PAGES',
  'SET_FIELD_VALUE',
])

export type HistoryAction = EditorAction | { type: 'UNDO' } | { type: 'REDO' }

export function historyReducer(history: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'UNDO') {
    const previous = history.past[history.past.length - 1]
    if (!previous) return history
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
      coalesceKey: null,
    }
  }

  if (action.type === 'REDO') {
    const next = history.future[0]
    if (!next) return history
    return {
      past: [...history.past, history.present],
      present: next,
      future: history.future.slice(1),
      coalesceKey: null,
    }
  }

  // Reset coalescing on tool/selection changes so a later edit to the same
  // element always starts a fresh undo step rather than silently merging
  // with a stale one from a previous editing session.
  if (
    action.type === 'SET_TOOL' ||
    action.type === 'SELECT_TEXT' ||
    action.type === 'SELECT_STROKES'
  ) {
    return { ...history, present: editorReducer(history.present, action), coalesceKey: null }
  }

  if (!CONTENT_ACTIONS.has(action.type)) {
    return { ...history, present: editorReducer(history.present, action) }
  }

  // Typing into a text box or a form field fires one action per keystroke;
  // coalesce consecutive edits to the same target into a single undo step.
  const coalesceKey =
    action.type === 'UPDATE_TEXT'
      ? `text:${action.id}`
      : action.type === 'SET_FIELD_VALUE'
        ? `field:${action.name}`
        : action.type === 'MOVE_STROKES'
          ? `strokes:${action.key}`
          : action.type === 'SCALE_STROKES'
            ? `scale:${action.key}`
            : null
  const shouldSnapshot = coalesceKey === null || coalesceKey !== history.coalesceKey
  const present = editorReducer(history.present, action)

  if (!shouldSnapshot) {
    return { ...history, present }
  }
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present,
    future: [],
    coalesceKey,
  }
}
