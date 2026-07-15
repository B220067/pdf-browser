import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { RenderingCancelledException } from 'pdfjs-dist'
import { isPdf } from '../lib/isPdf'
import { loadPdf } from '../lib/pdfjs'
import {
  UnsplittablePdfError,
  extractPages,
  formatPageRanges,
  getPageCount,
  parsePageRanges,
  splitToIndividualPdfs,
} from '../lib/splitPdf'
import { downloadBytes } from '../lib/savePdf'
import { softwareApplicationSchema } from '../lib/seoSchema'
import seoRoutes from '../seo-routes.json'
import { LockIcon, LogoMark } from './icons'

interface SplitPdfProps {
  onBack: () => void
}

const SOFTWARE_SCHEMA = softwareApplicationSchema({
  name: seoRoutes.split.schemaName,
  description: seoRoutes.split.schemaDescription,
  url: `https://inkspdf.com${seoRoutes.split.path}`,
  featureList: seoRoutes.split.featureList,
})

const THUMB_WIDTH = 100

/** Browsers can silently drop rapid-fire downloads; a small stagger fixes it. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function Thumbnail({ page }: { page: PDFPageProxy }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseViewport = page.getViewport({ scale: 1 })
  const displayHeight = (baseViewport.height / baseViewport.width) * THUMB_WIDTH

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = (THUMB_WIDTH / baseViewport.width) * 2 // 2x for crispness at thumbnail size
    const viewport = page.getViewport({ scale })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    task.promise.catch((err: unknown) => {
      if (!(err instanceof RenderingCancelledException)) console.error(err)
    })
    return () => task.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none block bg-white"
      style={{ width: THUMB_WIDTH, height: displayHeight }}
      aria-hidden
    />
  )
}

export function SplitPdf({ onBack }: SplitPdfProps) {
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState<PDFPageProxy[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [range, setRange] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setPages([])
    setSelected(new Set())
    setRange('')
    setRangeError(null)
  }

  const acceptFile = useCallback(async (incoming: File | undefined) => {
    if (!incoming) return
    if (!isPdf(incoming)) {
      setError(`"${incoming.name}" doesn't look like a PDF.`)
      return
    }
    setError(null)
    reset()
    setFile(incoming)
    try {
      const bytes = await incoming.arrayBuffer()
      const count = await getPageCount(bytes)
      const doc = await loadPdf(bytes)
      const proxies = await Promise.all(
        Array.from({ length: count }, (_, i) => doc.getPage(i + 1)),
      )
      setPages(proxies)
      const all = proxies.map((_, i) => i)
      setSelected(new Set(all))
      setRange(formatPageRanges(all))
    } catch (err) {
      setError(err instanceof UnsplittablePdfError ? err.message : 'Could not read this file.')
      setFile(null)
    }
  }, [])

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    void acceptFile(e.dataTransfer.files[0])
  }

  const toggle = (index: number) => {
    const next = new Set(selected)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelected(next)
    setRange(formatPageRanges([...next]))
    setRangeError(null)
  }

  const selectAll = () => {
    const all = pages.map((_, i) => i)
    setSelected(new Set(all))
    setRange(formatPageRanges(all))
    setRangeError(null)
  }

  const selectNone = () => {
    setSelected(new Set())
    setRange('')
    setRangeError(null)
  }

  const handleRangeChange = (value: string) => {
    setRange(value)
    try {
      setSelected(new Set(parsePageRanges(value, pages.length)))
      setRangeError(null)
    } catch (err) {
      // Leave the last valid selection (and the picker above) in place while
      // the user is mid-edit, but surface *why* so the typed text and the
      // actual selection never silently disagree.
      setRangeError(err instanceof Error ? err.message : 'Invalid page range.')
    }
  }

  const currentIndices = useCallback(() => {
    if (selected.size === 0) {
      setError('Select at least one page.')
      return null
    }
    return [...selected].sort((a, b) => a - b)
  }, [selected])

  const handleExtract = useCallback(async () => {
    if (!file || busy) return
    const indices = currentIndices()
    if (!indices) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const out = await extractPages(bytes, indices)
      downloadBytes(out, `${file.name.replace(/\.pdf$/i, '')}-pages.pdf`)
    } catch {
      setError('Could not extract those pages. The file may be corrupted.')
    } finally {
      setBusy(false)
    }
  }, [file, busy, currentIndices])

  const handleSplitEach = useCallback(async () => {
    if (!file || busy) return
    const indices = currentIndices()
    if (!indices) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const parts = await splitToIndividualPdfs(bytes, indices)
      for (const part of parts) {
        downloadBytes(part.bytes, part.name)
        await wait(150)
      }
    } catch {
      setError('Could not split this file. It may be corrupted.')
    } finally {
      setBusy(false)
    }
  }, [file, busy, currentIndices])

  return (
    <div className="min-h-screen bg-slate-100">
      <script type="application/ld+json">{JSON.stringify(SOFTWARE_SCHEMA)}</script>
      <nav className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <LogoMark width={24} height={24} className="rounded-md" />
            <span className="font-display text-lg tracking-tight text-slate-900">
              Inks<span className="text-ink-600">PDF</span>
            </span>
          </div>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault()
              onBack()
            }}
            className="text-sm font-medium text-slate-500 transition-colors hover:text-sky-600"
          >
            ← Back
          </a>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="font-display text-3xl text-slate-900">Split PDF</h1>
        <p className="mt-2 text-slate-600">
          Pull specific pages out of a PDF, or split it into individual files — still 100% in your
          browser.
        </p>

        {!file && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Add a PDF to split"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="mt-6 flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition-colors hover:border-sky-400 hover:bg-sky-50/50"
          >
            <p className="font-semibold text-slate-800">Add a PDF</p>
            <p className="text-sm text-slate-500">Drag a file in, or click to browse</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                void acceptFile(e.target.files?.[0] ?? undefined)
                e.target.value = ''
              }}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {file && (
          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <p className="font-display truncate text-xl text-slate-900" title={file.name}>
                    {file.name}
                  </p>
                  <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-ink-900/5 px-2.5 py-1 text-xs font-medium text-ink-600 sm:flex">
                    <LockIcon width={13} height={13} strokeWidth={2} />
                    Secure
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {pages.length} page{pages.length === 1 ? '' : 's'} · {selected.size} selected
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="shrink-0 text-sm font-medium text-slate-400 hover:text-red-600"
              >
                Remove
              </button>
            </div>

            {pages.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    Click pages to include or exclude
                  </span>
                  <div className="flex gap-3 text-xs font-medium text-sky-600">
                    <button type="button" onClick={selectAll} className="hover:underline">
                      Select all
                    </button>
                    <button type="button" onClick={selectNone} className="hover:underline">
                      Select none
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-5 md:grid-cols-6">
                  {pages.map((page, i) => {
                    const isSelected = selected.has(i)
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggle(i)}
                        aria-pressed={isSelected}
                        className={`relative rounded-lg border-2 p-1 transition-all ${
                          isSelected
                            ? 'border-sky-500 bg-white shadow-sm'
                            : 'border-transparent bg-white opacity-40 grayscale hover:opacity-70'
                        }`}
                      >
                        <Thumbnail page={page} />
                        <span
                          className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                            isSelected ? 'bg-sky-500 text-white' : 'bg-slate-300 text-slate-600'
                          }`}
                        >
                          {i + 1}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Pages to use</span>
              <input
                type="text"
                value={range}
                onChange={(e) => handleRangeChange(e.target.value)}
                placeholder={`e.g. 1-3, 5, 8-${pages.length}`}
                aria-invalid={rangeError !== null}
                className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                  rangeError
                    ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                    : 'border-slate-300 focus:border-sky-400 focus:ring-sky-400'
                }`}
              />
              {rangeError ? (
                <span className="text-xs text-red-600">
                  {rangeError} The picker above still reflects your last valid selection.
                </span>
              ) : (
                <span className="text-xs text-slate-400">
                  Comma-separated pages and ranges, 1–{pages.length}. Stays in sync with the picker above.
                </span>
              )}
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleExtract()}
                disabled={busy || selected.size === 0}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Working…' : 'Extract as one PDF'}
              </button>
              <button
                type="button"
                onClick={() => void handleSplitEach()}
                disabled={busy || selected.size === 0}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Working…' : 'Split into separate PDFs'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
