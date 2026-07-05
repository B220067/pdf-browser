import type { Dispatch } from 'react'
import type { HistoryAction } from '../lib/editorState'
import { clamp, pdfToDisplayed } from '../lib/coords'
import type { FormFieldValue, FormWidget, PageGeometry } from '../types'

interface FormFieldOverlayProps {
  widgets: FormWidget[]
  values: Record<string, FormFieldValue>
  geometry: PageGeometry
  scale: number
  dispatch: Dispatch<HistoryAction>
}

/**
 * Interactive HTML controls positioned exactly over a page's AcroForm
 * widgets. Always active regardless of the current tool — filling a form is
 * not a "mode". Values are written into the real form fields (and flattened)
 * at export time in savePdf.ts.
 */
export function FormFieldOverlay({ widgets, values, geometry, scale, dispatch }: FormFieldOverlayProps) {
  return (
    <>
      {widgets.map((w) => {
        // Map both structural corners into displayed space; rotation can
        // swap which corner ends up top-left, so take the min/max envelope.
        const a = pdfToDisplayed({ x: w.rect[0], y: w.rect[1] }, geometry)
        const b = pdfToDisplayed({ x: w.rect[2], y: w.rect[3] }, geometry)
        const left = Math.min(a.x, b.x) * scale
        const top = Math.min(a.y, b.y) * scale
        const width = Math.abs(a.x - b.x) * scale
        const height = Math.abs(a.y - b.y) * scale
        const value = values[w.fieldName]

        const boxStyle = { left, top, width, height }
        const common =
          'absolute z-10 rounded-sm border border-sky-300 bg-sky-50/70 focus:border-sky-500 focus:bg-white focus:outline-none'

        if (w.kind === 'checkbox') {
          return (
            <input
              key={w.id}
              type="checkbox"
              checked={value === true}
              disabled={w.readOnly}
              title={w.fieldName}
              onChange={(e) =>
                dispatch({ type: 'SET_FIELD_VALUE', name: w.fieldName, value: e.target.checked })
              }
              onPointerDown={(e) => e.stopPropagation()}
              className={`${common} cursor-pointer accent-sky-600`}
              style={boxStyle}
            />
          )
        }

        if (w.kind === 'radio') {
          return (
            <input
              key={w.id}
              type="radio"
              name={`radio-${w.fieldName}`}
              checked={typeof value === 'string' && value === w.exportValue}
              disabled={w.readOnly}
              title={`${w.fieldName}: ${w.exportValue ?? ''}`}
              onChange={() =>
                dispatch({
                  type: 'SET_FIELD_VALUE',
                  name: w.fieldName,
                  value: w.exportValue ?? '',
                })
              }
              onPointerDown={(e) => e.stopPropagation()}
              className={`${common} cursor-pointer accent-sky-600`}
              style={boxStyle}
            />
          )
        }

        if (w.kind === 'dropdown') {
          return (
            <select
              key={w.id}
              value={typeof value === 'string' ? value : ''}
              disabled={w.readOnly}
              title={w.fieldName}
              onChange={(e) =>
                dispatch({ type: 'SET_FIELD_VALUE', name: w.fieldName, value: e.target.value })
              }
              onPointerDown={(e) => e.stopPropagation()}
              className={`${common} text-slate-900`}
              style={{ ...boxStyle, fontSize: clamp(height * 0.55, 9, 16 * scale) }}
            >
              <option value="" />
              {(w.options ?? []).map((o) => (
                <option key={o.exportValue} value={o.exportValue}>
                  {o.displayValue || o.exportValue}
                </option>
              ))}
            </select>
          )
        }

        // Text field. Font size tracks the widget height like most PDF
        // viewers do for auto-sized fields.
        const fontSize = clamp(height * (w.multiLine ? 0.28 : 0.55), 8, 28)
        const Tag = w.multiLine ? 'textarea' : 'input'
        return (
          <Tag
            key={w.id}
            {...(w.multiLine ? {} : { type: 'text' })}
            value={typeof value === 'string' ? value : ''}
            disabled={w.readOnly}
            title={w.fieldName}
            onChange={(e) =>
              dispatch({ type: 'SET_FIELD_VALUE', name: w.fieldName, value: e.target.value })
            }
            onPointerDown={(e) => e.stopPropagation()}
            className={`${common} resize-none px-1 text-slate-900`}
            style={{ ...boxStyle, fontSize }}
          />
        )
      })}
    </>
  )
}
