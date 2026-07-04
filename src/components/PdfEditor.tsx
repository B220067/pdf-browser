import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { loadPdf } from '../lib/pdfjs'
import { normalizeRotation, clamp } from '../lib/coords'
import { editorReducer, initialEditorState } from '../lib/editorState'
import {
  downloadBytes,
  editedFileName,
  EncryptedPdfError,
  exportEditedPdf,
  isPdfEncrypted,
} from '../lib/savePdf'
import type { PageGeometry, Tool } from '../types'
import { PdfPage } from './PdfPage'
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
}

const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  t: 'text',
  d: 'draw',
  e: 'erase',
}

export function PdfEditor({ bytes, fileName, onClose }: PdfEditorProps) {
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)

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
        if (!cancelled) setLoaded({ doc, pages, geometries })
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
        dispatch({ type: 'UNDO_STROKE' })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedTextId) {
          e.preventDefault()
          dispatch({ type: 'REMOVE_TEXT', id: state.selectedTextId })
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
  }, [state.selectedTextId])

  // ----- save / download ----------------------------------------------------
  const handleDownload = useCallback(async () => {
    if (!loaded || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const out = await exportEditedPdf(bytes, loaded.geometries, state.texts, state.strokes)
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
  }, [loaded, saving, bytes, state.texts, state.strokes, fileName])

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
        canUndoStroke={state.strokes.length > 0}
        zoom={zoom}
        saving={saving}
        dispatch={dispatch}
        onZoom={handleZoom}
        onDownload={() => void handleDownload()}
        onClose={onClose}
      />

      {saveError && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="flex min-w-fit flex-col items-center gap-6 px-8 py-8">
          {loaded.pages.map((page, i) => (
            <PdfPage
              key={i}
              page={page}
              geometry={loaded.geometries[i]}
              scale={scale}
              state={state}
              dispatch={dispatch}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
