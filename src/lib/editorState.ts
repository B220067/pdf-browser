import type { Stroke, TextElement, Tool } from '../types'

export interface EditorState {
  tool: Tool
  texts: TextElement[]
  strokes: Stroke[]
  selectedTextId: string | null
  penColor: string
  penWidth: number
}

export const initialEditorState: EditorState = {
  tool: 'select',
  texts: [],
  strokes: [],
  selectedTextId: null,
  penColor: '#1d4ed8',
  penWidth: 2,
}

export type EditorAction =
  | { type: 'SET_TOOL'; tool: Tool }
  | { type: 'ADD_TEXT'; element: TextElement }
  | { type: 'UPDATE_TEXT'; id: string; patch: Partial<Omit<TextElement, 'id' | 'pageIndex'>> }
  | { type: 'REMOVE_TEXT'; id: string }
  | { type: 'SELECT_TEXT'; id: string | null }
  | { type: 'ADD_STROKE'; stroke: Stroke }
  | { type: 'REMOVE_STROKE'; id: string }
  | { type: 'UNDO_STROKE' }
  | { type: 'SET_PEN'; color?: string; width?: number }

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_TOOL':
      return {
        ...state,
        tool: action.tool,
        selectedTextId: action.tool === 'select' ? state.selectedTextId : null,
      }
    case 'ADD_TEXT':
      // Adding a box drops you straight into editing it with the select tool.
      return {
        ...state,
        texts: [...state.texts, action.element],
        selectedTextId: action.element.id,
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
      return { ...state, selectedTextId: action.id }
    case 'ADD_STROKE':
      return { ...state, strokes: [...state.strokes, action.stroke] }
    case 'REMOVE_STROKE':
      return { ...state, strokes: state.strokes.filter((s) => s.id !== action.id) }
    case 'UNDO_STROKE':
      return { ...state, strokes: state.strokes.slice(0, -1) }
    case 'SET_PEN':
      return {
        ...state,
        penColor: action.color ?? state.penColor,
        penWidth: action.width ?? state.penWidth,
      }
  }
}
