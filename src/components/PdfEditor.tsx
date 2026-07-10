import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { OPS } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { loadPdf } from '../lib/pdfjs'
import { normalizeRotation, clamp, effectiveGeometry } from '../lib/coords'
import { historyReducer, initialHistoryState } from '../lib/editorState'
import {
  downloadBytes,
  editedFileName,
  EncryptedPdfError,
  exportEditedPdf,
  isPdfEncrypted,
} from '../lib/savePdf'
import type { FormFieldValue, FormWidget, PageGeometry, Tool } from '../types'
import { CloseIcon } from './icons'
import { MobilePageDrawer } from './MobilePageDrawer'
import { PageThumbnails } from './PageThumbnails'
import { PdfPage } from './PdfPage'
import { SignatureCapture } from './SignatureCapture'
import { Toolbar } from './Toolbar'

interface PdfEditorProps {
  bytes: ArrayBuffer
  fileName: string
  onClose: () => void
}

interface LoadedDoc {
  doc: PDFDocumentProxy
  pages: PDFPageProxy[]
  geometries: PageGeometry[]
  formWidgets: FormWidget[]
  /** Whether each page paints any image XObject — mirrors the same check
   *  savePdf.ts uses to decide if word-level redaction is possible on a
   *  page, computed once here so the redact tool can preview it live. */
  pageHasImages: boolean[]
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
])

async function pageHasImageOp(page: PDFPageProxy): Promise<boolean> {
  const { fnArray } = await page.getOperatorList()
  return fnArray.some((fn) => IMAGE_OPS.has(fn))
}

const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  t: 'text',
  d: 'draw',
  e: 'erase',
  h: 'highlight',
  r: 'redact',
}

/**
 * Map pdf.js widget annotations onto our FormWidget model and collect each
 * field's current value. Shapes verified against pdf.js output for real
 * AcroForm files: text fields are fieldType 'Tx'; checkboxes/radios are
 * 'Btn' with checkBox/radioButton flags (radios expose their per-widget
 * "on" value as buttonValue, checkboxes as exportValue); dropdowns are 'Ch'.
 */
function extractFormWidgets(
  annots: Array<Record<string, unknown>>,
  pageIndex: number,
): { widgets: FormWidget[]; values: Record<string, FormFieldValue> } {
  const widgets: FormWidget[] = []
  const values: Record<string, FormFieldValue> = {}

  for (const a of annots) {
    if (a.subtype !== 'Widget' || typeof a.fieldName !== 'string' || !a.fieldName) continue
    const rect = a.rect as [number, number, number, number] | undefined
    if (!rect) continue
    const base = {
      id: String(a.id ?? crypto.randomUUID()),
      fieldName: a.fieldName,
      pageIndex,
      rect,
      readOnly: a.readOnly === true,
    }
    const fieldValue = a.fieldValue

    if (a.fieldType === 'Tx') {
      widgets.push({ ...base, kind: 'text', multiLine: a.multiLine === true })
      values[base.fieldName] = typeof fieldValue === 'string' ? fieldValue : ''
    } else if (a.fieldType === 'Btn' && a.checkBox === true) {
      const exportValue = typeof a.exportValue === 'string' ? a.exportValue : 'Yes'
      widgets.push({ ...base, kind: 'checkbox', exportValue })
      values[base.fieldName] = fieldValue !== 'Off' && fieldValue != null && fieldValue !== ''
    } else if (a.fieldType === 'Btn' && a.radioButton === true) {
      const exportValue = typeof a.buttonValue === 'string' ? a.buttonValue : ''
      widgets.push({ ...base, kind: 'radio', exportValue })
      values[base.fieldName] =
        typeof fieldValue === 'string' && fieldValue !== 'Off' ? fieldValue : ''
    } else if (a.fieldType === 'Ch') {
      const options = Array.isArray(a.options)
        ? (a.options as Array<{ exportValue?: unknown; displayValue?: unknown }>).map((o) => ({
            exportValue: String(o.exportValue ?? ''),
            displayValue: String(o.displayValue ?? ''),
          }))
        : []
      widgets.push({ ...base, kind: 'dropdown', options })
      const v = Array.isArray(fieldValue) ? fieldValue[0] : fieldValue
      values[base.fieldName] = typeof v === 'string' ? v : ''
    }
    // Push buttons and unknown field types are left untouched.
  }
  return { widgets, values }
}

export function PdfEditor({ bytes, fileName, onClose }: PdfEditorProps) {
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [signatureModalOpen, setSignatureModalOpen] = useState(false)
  const [pageDrawerOpen, setPageDrawerOpen] = useState(false)
  const [inkNoticeDismissed, setInkNoticeDismissed] = useState(false)
  const [redactNoticeDismissed, setRedactNoticeDismissed] = useState(false)
  const [redactHintDismissed, setRedactHintDismissed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [history, dispatch] = useReducer(historyReducer, initialHistoryState)
  const state = history.present

  // ----- document loading -------------------------------------------------
  useEffect(() => {
    let cancelled = false
    let docHandle: PDFDocumentProxy | null = null
    ;(async () => {
      try {
        // Owner-password-only PDFs (no user password) open fine in pdf.js
        // with no prompt, but pdf-lib can't safely re-save them — it has no
        // encryption support, so editing would only be discoverable as a
        // failure at download time. Reject up front instead.
        if (await isPdfEncrypted(bytes)) {
          if (!cancelled) {
            setLoadError(
              'This PDF is encrypted or has security restrictions (e.g. no editing or printing) and can\'t be edited here. Remove its password/restrictions first — for example, open it in a PDF reader and use "Print to PDF" to make an unrestricted copy — then re-upload.',
            )
          }
          return
        }
        const doc = await loadPdf(bytes)
        docHandle = doc
        const pages = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
        )
        const geometries = pages.map((page, pageIndex): PageGeometry => {
          const viewport = page.getViewport({ scale: 1 })
          const [x1, y1, x2, y2] = page.view
          return {
            pageIndex,
            width: viewport.width,
            height: viewport.height,
            rotation: normalizeRotation(page.rotate),
            viewX: x1,
            viewY: y1,
            viewWidth: x2 - x1,
            viewHeight: y2 - y1,
          }
        })
        // Detect fillable AcroForm fields on every page.
        const allWidgets: FormWidget[] = []
        const allValues: Record<string, FormFieldValue> = {}
        for (let i = 0; i < pages.length; i++) {
          const annots = (await pages[i].getAnnotations({ intent: 'display' })) as Array<
            Record<string, unknown>
          >
          const { widgets, values } = extractFormWidgets(annots, i)
          allWidgets.push(...widgets)
          Object.assign(allValues, values)
        }
        const pageHasImages = await Promise.all(pages.map(pageHasImageOp))

        if (!cancelled) {
          setLoaded({ doc, pages, geometries, formWidgets: allWidgets, pageHasImages })
          dispatch({ type: 'INIT_PAGES', count: pages.length })
          if (allWidgets.length > 0) dispatch({ type: 'INIT_FIELDS', values: allValues })
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setLoadError(
            err instanceof Error && err.name === 'PasswordException'
              ? 'This PDF is password-protected and cannot be opened.'
              : 'Could not open this PDF. The file may be corrupted.',
          )
        }
      }
    })()
    return () => {
      cancelled = true
      void docHandle?.destroy()
    }
  }, [bytes])

  // ----- fit-to-width scale ------------------------------------------------
  // Measured once per file load, NOT continuously. The browser's own zoom
  // (Ctrl +/-) reports a bigger CSS-pixel width for this container when you
  // zoom out — if we kept re-fitting to that, the page would rescale right
  // back up to fill it, canceling out the browser's zoom entirely. Freezing
  // this after the first measurement lets native browser zoom shrink/grow
  // the page like any normal web content. The "reset zoom" button below
  // re-measures on demand, for when the window itself was actually resized.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width)
      observer.disconnect()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loaded])

  const scale = useMemo(() => {
    if (!loaded || containerWidth === 0) return 1
    const widest = Math.max(...loaded.geometries.map((g) => g.width))
    const fit = (containerWidth - 64) / widest
    return clamp(fit, 0.2, 4) * zoom
  }, [loaded, containerWidth, zoom])

  const handleZoom = useCallback((factor: number) => {
    if (factor === 0) {
      // Re-measure in case the window was actually resized since load.
      const el = scrollRef.current
      if (el) setContainerWidth(el.getBoundingClientRect().width)
      setZoom(1)
      return
    }
    // Floor was 0.4 — reached after only ~5 clicks, after which "Zoom out"
    // silently did nothing. Lowered so it keeps shrinking like a normal PDF
    // viewer's zoom-out.
    setZoom((z) => clamp(z * factor, 0.1, 3))
  }, [])

  // ----- page navigation (thumbnail click) -----------------------------------
  // Pages are keyed by their ORIGINAL index (data-page in PdfPage.tsx), which
  // stays stable across reorder/rotate — matches what PageThumbnails/
  // MobilePageDrawer already track per entry.
  const handleNavigateToPage = useCallback((originalIndex: number) => {
    const el = scrollRef.current?.querySelector(`[data-page="${originalIndex}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ----- unsaved-work protection ---------------------------------------------
  // Refreshing, closing the tab, or navigating away loses everything (state
  // is in-memory only, no autosave) — warn while there's undo history to lose.
  useEffect(() => {
    if (history.past.length === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [history.past.length])

  const handleClose = useCallback(() => {
    if (history.past.length > 0 && !window.confirm('Close without saving? Your edits will be lost.')) {
      return
    }
    onClose()
  }, [history.past.length, onClose])

  // Once the user has actually drawn a redaction box, they've seen the live
  // preview firsthand — the hint has done its job, stop showing it.
  useEffect(() => {
    if (state.redactions.length > 0) setRedactHintDismissed(true)
  }, [state.redactions.length])

  // ----- signature capture / stamping ---------------------------------------
  const handleSignatureClick = useCallback(() => {
    if (state.savedSignature) {
      dispatch({ type: 'SET_TOOL', tool: 'stamp' })
    } else {
      setSignatureModalOpen(true)
    }
  }, [state.savedSignature])

  // ----- keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editingText =
        !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if (e.key === 'Escape') {
        if (editingText) target.blur()
        dispatch({ type: 'SELECT_TEXT', id: null })
        return
      }
      if (editingText) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'REDO' })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedTextId) {
          e.preventDefault()
          dispatch({ type: 'REMOVE_TEXT', id: state.selectedTextId })
        } else if (state.selectedStrokeKey) {
          e.preventDefault()
          dispatch({ type: 'REMOVE_STROKES', key: state.selectedStrokeKey })
        } else if (state.selectedRedactionId) {
          e.preventDefault()
          dispatch({ type: 'REMOVE_REDACTION', id: state.selectedRedactionId })
        }
        return
      }
      const tool = TOOL_SHORTCUTS[e.key.toLowerCase()]
      if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        dispatch({ type: 'SET_TOOL', tool })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.selectedTextId, state.selectedStrokeKey, state.selectedRedactionId])

  // ----- save / download ----------------------------------------------------
  const handleDownload = useCallback(async () => {
    if (!loaded || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const out = await exportEditedPdf(
        bytes,
        loaded.geometries,
        state.texts,
        state.strokes,
        state.pageOrder,
        state.formFieldValues,
        state.redactions,
      )
      downloadBytes(out, editedFileName(fileName))
    } catch (err) {
      console.error(err)
      // Belt-and-suspenders: the load-time check above should already have
      // kept encrypted files out of the editor entirely.
      setSaveError(
        err instanceof EncryptedPdfError
          ? 'This PDF is encrypted and cannot be saved.'
          : 'Saving failed. This PDF may use features pdf-lib cannot modify.',
      )
    } finally {
      setSaving(false)
    }
  }, [
    loaded,
    saving,
    bytes,
    state.texts,
    state.strokes,
    state.pageOrder,
    state.formFieldValues,
    state.redactions,
    fileName,
  ])

  // ----- render ---------------------------------------------------------------
  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 p-6">
        <p className="rounded-lg bg-red-50 px-6 py-4 text-red-700">{loadError}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
        >
          Choose another file
        </button>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
          Opening {fileName}…
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-slate-200">
      <Toolbar
        fileName={fileName}
        tool={state.tool}
        penColor={state.penColor}
        penWidth={state.penWidth}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        hasSavedSignature={!!state.savedSignature}
        zoom={zoom}
        saving={saving}
        pageDrawerOpen={pageDrawerOpen}
        showRedactHint={state.tool === 'redact' && !redactHintDismissed}
        dispatch={dispatch}
        onZoom={handleZoom}
        onDownload={() => void handleDownload()}
        onClose={handleClose}
        onDismissRedactHint={() => setRedactHintDismissed(true)}
        onSignatureClick={handleSignatureClick}
        onRedrawSignature={() => setSignatureModalOpen(true)}
        onPageDrawerToggle={() => setPageDrawerOpen(!pageDrawerOpen)}
      />

      {signatureModalOpen && (
        <SignatureCapture
          penColor={state.penColor}
          penWidth={state.penWidth}
          onCancel={() => setSignatureModalOpen(false)}
          onSave={(signature) => {
            dispatch({ type: 'SET_SAVED_SIGNATURE', signature })
            dispatch({ type: 'SET_TOOL', tool: 'stamp' })
            setSignatureModalOpen(false)
          }}
        />
      )}

      <MobilePageDrawer
        open={pageDrawerOpen}
        pages={loaded.pages}
        geometries={loaded.geometries}
        pageOrder={state.pageOrder}
        dispatch={dispatch}
        onClose={() => setPageDrawerOpen(false)}
        onNavigateToPage={(originalIndex) => {
          handleNavigateToPage(originalIndex)
          setPageDrawerOpen(false)
        }}
      />

      {saveError && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {state.strokes.length > 0 && !inkNoticeDismissed && (
        <div
          role="note"
          className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          <span>
            Drawing covers content visually — it doesn't remove or redact the text underneath.
          </span>
          <button
            type="button"
            onClick={() => setInkNoticeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 hover:bg-amber-100"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      )}

      {state.redactions.length > 0 && !redactNoticeDismissed && (
        <div
          role="note"
          className="flex items-center justify-between gap-3 border-b border-slate-300 bg-slate-800 px-4 py-2 text-sm text-slate-100"
        >
          <span>
            Redacted content is permanently removed on download — any page with a black box is flattened to an
            image, so its text stops being selectable, searchable, or copyable.
          </span>
          <button
            type="button"
            onClick={() => setRedactNoticeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 hover:bg-slate-700"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <PageThumbnails
          pages={loaded.pages}
          geometries={loaded.geometries}
          pageOrder={state.pageOrder}
          dispatch={dispatch}
          onNavigateToPage={handleNavigateToPage}
        />
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div className="flex min-w-fit flex-col items-center gap-6 px-8 py-8">
            {state.pageOrder.map((entry, position) => (
              <PdfPage
                key={entry.originalIndex}
                page={loaded.pages[entry.originalIndex]}
                geometry={effectiveGeometry(loaded.geometries[entry.originalIndex], entry.rotationDelta)}
                rotationDelta={entry.rotationDelta}
                displayIndex={position}
                formWidgets={loaded.formWidgets.filter((w) => w.pageIndex === entry.originalIndex)}
                hasImages={loaded.pageHasImages[entry.originalIndex]}
                scale={scale}
                state={state}
                dispatch={dispatch}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
