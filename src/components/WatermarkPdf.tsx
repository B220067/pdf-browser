import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { RenderingCancelledException } from 'pdfjs-dist'
import { isPdf } from '../lib/isPdf'
import { loadPdf } from '../lib/pdfjs'
import { getPageCount } from '../lib/splitPdf'
import { MARGIN, UnstampablePdfError, applyStamp, type PageNumberPosition } from '../lib/watermarkPdf'
import { downloadBytes } from '../lib/savePdf'
import { softwareApplicationSchema } from '../lib/seoSchema'
import seoRoutes from '../seo-routes.json'
import { ColorSwatches } from './ColorSwatches'
import { LockIcon, LogoMark } from './icons'

interface WatermarkPdfProps {
  onBack: () => void
}

const SOFTWARE_SCHEMA = softwareApplicationSchema({
  name: seoRoutes.watermark.schemaName,
  description: seoRoutes.watermark.schemaDescription,
  url: `https://inkspdf.com${seoRoutes.watermark.path}`,
  featureList: seoRoutes.watermark.featureList,
})

const POSITIONS: { value: PageNumberPosition; label: string }[] = [
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
]

const PREVIEW_WIDTH = 460

const DEFAULT_WATERMARK_SIZE = 48
const DEFAULT_WATERMARK_ROTATION = 45
const DEFAULT_NUMBER_SIZE = 11
const DEFAULT_NUMBER_START = 1
const MAX_WATERMARK_ANGLE = 359

/**
 * These size/angle fields are plain text (not `type="number"`) on purpose:
 * native number inputs sanitize/clamp their value inconsistently across
 * browsers while the user is mid-edit (e.g. clearing "48" to type "70"),
 * which fights a controlled value and can make a digit un-deletable. Typed
 * text is filtered to digits only and parsed where the number is consumed.
 */
function sanitizeIntText(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

function parseIntOr(text: string, fallback: number): number {
  const n = parseInt(text, 10)
  return Number.isFinite(n) ? n : fallback
}

/** Position a page-number preview label the same way positionFor() in watermarkPdf.ts does, in CSS pixels. */
function numberPreviewStyle(position: PageNumberPosition, marginPx: number): CSSProperties {
  const style: CSSProperties = { position: 'absolute' }
  if (position.startsWith('bottom')) style.bottom = marginPx
  else style.top = marginPx
  if (position.endsWith('left')) style.left = marginPx
  else if (position.endsWith('right')) style.right = marginPx
  else {
    style.left = '50%'
    style.transform = 'translateX(-50%)'
  }
  return style
}

function PreviewCanvas({ page }: { page: PDFPageProxy }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = (PREVIEW_WIDTH / baseViewport.width) * 2 // 2x for crispness
    const viewport = page.getViewport({ scale })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    task.promise.catch((err: unknown) => {
      if (!(err instanceof RenderingCancelledException)) console.error(err)
    })
    return () => task.cancel()
  }, [page])

  return <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
}

export function WatermarkPdf({ onBack }: WatermarkPdfProps) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [pageCount, setPageCount] = useState(1)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [previewPage, setPreviewPage] = useState<PDFPageProxy | null>(null)
  const [previewDims, setPreviewDims] = useState<{ width: number; height: number } | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [pageInputText, setPageInputText] = useState('1')

  const [watermarkOn, setWatermarkOn] = useState(true)
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL')
  const [watermarkColor, setWatermarkColor] = useState('#94a3b8')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.3)
  const [watermarkSizeText, setWatermarkSizeText] = useState(String(DEFAULT_WATERMARK_SIZE))
  const [watermarkRotationText, setWatermarkRotationText] = useState(String(DEFAULT_WATERMARK_ROTATION))

  const [numbersOn, setNumbersOn] = useState(false)
  const [numberFormat, setNumberFormat] = useState('Page {n} of {total}')
  const [numberStartText, setNumberStartText] = useState(String(DEFAULT_NUMBER_START))
  const [numberColor, setNumberColor] = useState('#111827')
  const [numberSizeText, setNumberSizeText] = useState(String(DEFAULT_NUMBER_SIZE))
  const [numberPosition, setNumberPosition] = useState<PageNumberPosition>('bottom-center')

  const acceptFile = useCallback(async (incoming: File | undefined) => {
    if (!incoming) return
    if (!isPdf(incoming)) {
      setError(`"${incoming.name}" doesn't look like a PDF.`)
      return
    }
    setError(null)
    setFile(incoming)
    setPdfDoc(null)
    setPreviewPage(null)
    setPreviewDims(null)
    setPreviewIndex(0)
    setPageInputText('1')
    try {
      const bytes = await incoming.arrayBuffer()
      const count = await getPageCount(bytes)
      setPageCount(count)
      setPdfDoc(await loadPdf(bytes))
    } catch (err) {
      setError(err instanceof UnstampablePdfError ? err.message : 'Could not read this file.')
      setFile(null)
    }
  }, [])

  // Fetch (and re-fetch on navigation) the single page currently shown in the preview.
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    pdfDoc.getPage(previewIndex + 1).then((page) => {
      if (cancelled) return
      setPreviewPage(page)
      const viewport = page.getViewport({ scale: 1 })
      setPreviewDims({ width: viewport.width, height: viewport.height })
    })
    return () => {
      cancelled = true
    }
  }, [pdfDoc, previewIndex])

  // Keep the page-jump field in sync with arrow navigation; typing handles its own state.
  useEffect(() => {
    setPageInputText(String(previewIndex + 1))
  }, [previewIndex])

  const goToPrevPage = () => setPreviewIndex((i) => Math.max(0, i - 1))
  const goToNextPage = () => setPreviewIndex((i) => Math.min(pageCount - 1, i + 1))

  const handlePageInputChange = (raw: string) => {
    const cleaned = sanitizeIntText(raw)
    setPageInputText(cleaned)
    const n = parseInt(cleaned, 10)
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) setPreviewIndex(n - 1)
  }

  const handlePageInputBlur = () => setPageInputText(String(previewIndex + 1))

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    void acceptFile(e.dataTransfer.files[0])
  }

  const handleApply = useCallback(async () => {
    if (!file || busy) return
    if (!watermarkOn && !numbersOn) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const out = await applyStamp(
        bytes,
        watermarkOn
          ? {
              text: watermarkText,
              fontSize: parseIntOr(watermarkSizeText, DEFAULT_WATERMARK_SIZE),
              color: watermarkColor,
              opacity: watermarkOpacity,
              rotationDeg: parseIntOr(watermarkRotationText, DEFAULT_WATERMARK_ROTATION),
            }
          : null,
        numbersOn
          ? {
              format: numberFormat,
              startAt: parseIntOr(numberStartText, DEFAULT_NUMBER_START),
              fontSize: parseIntOr(numberSizeText, DEFAULT_NUMBER_SIZE),
              color: numberColor,
              position: numberPosition,
            }
          : null,
      )
      downloadBytes(out, `${file.name.replace(/\.pdf$/i, '')}-stamped.pdf`)
    } catch (err) {
      setError(err instanceof UnstampablePdfError ? err.message : 'Could not stamp this file.')
    } finally {
      setBusy(false)
    }
  }, [
    file,
    busy,
    watermarkOn,
    watermarkText,
    watermarkSizeText,
    watermarkColor,
    watermarkOpacity,
    watermarkRotationText,
    numbersOn,
    numberFormat,
    numberStartText,
    numberSizeText,
    numberColor,
    numberPosition,
  ])

  const scale = previewDims ? PREVIEW_WIDTH / previewDims.width : 1
  const previewHeight = previewDims ? previewDims.height * scale : 0
  const previewNumberText = numberFormat
    .replace(/\{n\}/g, String(parseIntOr(numberStartText, DEFAULT_NUMBER_START) + previewIndex))
    .replace(/\{total\}/g, String(pageCount))
  const angleOutOfRange = parseIntOr(watermarkRotationText, DEFAULT_WATERMARK_ROTATION) > MAX_WATERMARK_ANGLE
  // Empty watermark text simply isn't drawn (applyStamp no-ops it), so it
  // shouldn't block a valid "page numbers only" submission on its own.
  const watermarkWillDraw = watermarkOn && watermarkText.trim().length > 0
  const nothingToApply = !watermarkWillDraw && !numbersOn

  return (
    <div className="min-h-screen bg-slate-100">
      <script type="application/ld+json">{JSON.stringify(SOFTWARE_SCHEMA)}</script>
      <nav className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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

      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="font-display text-3xl text-slate-900">Watermark &amp; page numbers</h1>
        <p className="mt-2 text-slate-600">
          Stamp a watermark and/or page numbers across every page — still 100% in your browser.
        </p>

        {!file && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Add a PDF to stamp"
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
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <p className="font-display truncate text-xl text-slate-900" title={file.name}>
                    {file.name}
                  </p>
                  <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-ink-900/5 px-2.5 py-1 text-xs font-medium text-ink-600 sm:flex">
                    <LockIcon width={13} height={13} strokeWidth={2} />
                    Secure
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null)
                    setError(null)
                    setPdfDoc(null)
                    setPreviewPage(null)
                    setPreviewDims(null)
                    setPreviewIndex(0)
                    setPageInputText('1')
                  }}
                  className="shrink-0 text-sm font-medium text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>

              <section className="flex flex-col gap-3 border-t border-slate-100 pt-5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={watermarkOn}
                    onChange={(e) => setWatermarkOn(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-slate-800">Watermark</span>
                </label>

                {watermarkOn && (
                  <div className="ml-6 flex flex-col gap-3">
                    <input
                      type="text"
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      placeholder="Watermark text"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                    />
                    <div className="flex flex-wrap items-center gap-4">
                      <ColorSwatches value={watermarkColor} onChange={setWatermarkColor} ariaLabel="Watermark color" />
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Size
                        <input
                          type="text"
                          inputMode="numeric"
                          value={watermarkSizeText}
                          onChange={(e) => setWatermarkSizeText(sanitizeIntText(e.target.value))}
                          onBlur={() =>
                            setWatermarkSizeText(String(parseIntOr(watermarkSizeText, DEFAULT_WATERMARK_SIZE)))
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Angle
                        <input
                          type="text"
                          inputMode="numeric"
                          value={watermarkRotationText}
                          onChange={(e) => setWatermarkRotationText(sanitizeIntText(e.target.value))}
                          onBlur={() =>
                            setWatermarkRotationText(
                              String(parseIntOr(watermarkRotationText, DEFAULT_WATERMARK_ROTATION)),
                            )
                          }
                          aria-invalid={angleOutOfRange}
                          className={`w-16 rounded border px-2 py-1 text-sm ${
                            angleOutOfRange ? 'border-red-400' : 'border-slate-300'
                          }`}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Opacity
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(watermarkOpacity * 100)}
                          onChange={(e) => setWatermarkOpacity(Number(e.target.value) / 100)}
                          className="w-24"
                        />
                        <span className="w-9 text-slate-600">{Math.round(watermarkOpacity * 100)}%</span>
                      </label>
                    </div>
                    {angleOutOfRange && (
                      <p className="text-xs text-red-600">Angle must be between 0 and 360.</p>
                    )}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-3 border-t border-slate-100 pt-5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={numbersOn}
                    onChange={(e) => setNumbersOn(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-slate-800">Page numbers</span>
                </label>

                {numbersOn && (
                  <div className="ml-6 flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-slate-500">Format ({'{n}'} and {'{total}'} are replaced)</span>
                      <input
                        type="text"
                        value={numberFormat}
                        onChange={(e) => setNumberFormat(e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-4">
                      <ColorSwatches value={numberColor} onChange={setNumberColor} ariaLabel="Page number color" />
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Size
                        <input
                          type="text"
                          inputMode="numeric"
                          value={numberSizeText}
                          onChange={(e) => setNumberSizeText(sanitizeIntText(e.target.value))}
                          onBlur={() => setNumberSizeText(String(parseIntOr(numberSizeText, DEFAULT_NUMBER_SIZE)))}
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Starts at
                        <input
                          type="text"
                          inputMode="numeric"
                          value={numberStartText}
                          onChange={(e) => setNumberStartText(sanitizeIntText(e.target.value))}
                          onBlur={() =>
                            setNumberStartText(String(parseIntOr(numberStartText, DEFAULT_NUMBER_START)))
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <select
                        value={numberPosition}
                        onChange={(e) => setNumberPosition(e.target.value as PageNumberPosition)}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        {POSITIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </section>

              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={busy || nothingToApply || (watermarkOn && angleOutOfRange)}
                className="mt-1 flex items-center gap-2 self-start rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Applying…' : 'Apply & Download'}
              </button>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 lg:sticky lg:top-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Preview</p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={goToPrevPage}
                    disabled={previewIndex === 0}
                    aria-label="Previous page"
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ←
                  </button>
                  <span className="flex items-center gap-1.5 text-sm text-slate-600">
                    Page
                    <input
                      type="text"
                      inputMode="numeric"
                      value={pageInputText}
                      onChange={(e) => handlePageInputChange(e.target.value)}
                      onBlur={handlePageInputBlur}
                      aria-label="Preview page number"
                      className="w-12 rounded border border-slate-300 px-1.5 py-1 text-center text-sm"
                    />
                    of {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={goToNextPage}
                    disabled={previewIndex >= pageCount - 1}
                    aria-label="Next page"
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </div>

              <div
                className="relative mx-auto overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                style={{ width: PREVIEW_WIDTH, height: previewHeight || undefined }}
              >
                {previewPage && <PreviewCanvas page={previewPage} />}

                {watermarkOn && watermarkText.trim() && (
                  <div
                    className="absolute select-none whitespace-nowrap"
                    style={{
                      left: '50%',
                      top: '50%',
                      transform: `translate(-50%, -50%) rotate(${-parseIntOr(watermarkRotationText, DEFAULT_WATERMARK_ROTATION)}deg)`,
                      color: watermarkColor,
                      opacity: watermarkOpacity,
                      fontSize: parseIntOr(watermarkSizeText, DEFAULT_WATERMARK_SIZE) * scale,
                      fontFamily: 'Helvetica, Arial, sans-serif',
                    }}
                  >
                    {watermarkText.trim()}
                  </div>
                )}

                {numbersOn && (
                  <div
                    className="select-none whitespace-nowrap"
                    style={{
                      ...numberPreviewStyle(numberPosition, MARGIN * scale),
                      color: numberColor,
                      fontSize: parseIntOr(numberSizeText, DEFAULT_NUMBER_SIZE) * scale,
                      fontFamily: 'Helvetica, Arial, sans-serif',
                    }}
                  >
                    {previewNumberText}
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400">Approximate — actual spacing may vary slightly by font.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
