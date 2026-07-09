import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { isPdf } from '../lib/isPdf'
import { EyeOffIcon, ExpandIcon, FileIcon, LockIcon, LogoMark, ZapIcon } from './icons'

interface DropZoneProps {
  onFile: (bytes: ArrayBuffer, name: string) => void
  onMergeClick: () => void
  onSplitClick: () => void
  onWatermarkClick: () => void
  onTermsClick: () => void
  onPrivacyClick: () => void
}

const TRUST_BADGES = [
  {
    icon: LockIcon,
    label: 'Local-only',
    desc: 'Your file is opened, edited, and saved without ever touching a server.',
  },
  {
    icon: EyeOffIcon,
    label: 'No tracking',
    desc: "We don't log, analyze, or even see your file's contents",
  },
  {
    icon: ZapIcon,
    label: 'No signup',
    desc: 'No account, no email — just drop a file and start',
  },
  {
    icon: ExpandIcon,
    label: 'No file size limit',
    desc: 'Edit a 400-page contract as easily as a single page.',
  },
]

const HOW_IT_WORKS = [
  { step: '1', title: 'Drop your file', desc: 'Drag a PDF in, or click to browse your files.' },
  { step: '2', title: 'Edit & sign', desc: 'Add text, draw, or stamp a saved signature.' },
  { step: '3', title: 'Download', desc: 'Save your finished PDF, ready to share or print.' },
]

export function DropZone({
  onFile,
  onMergeClick,
  onSplitClick,
  onWatermarkClick,
  onTermsClick,
  onPrivacyClick,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Drag events fire enter/leave for every child; count to avoid flicker.
  const dragDepth = useRef(0)

  const acceptFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (!isPdf(file)) {
        setError(`"${file.name}" doesn't look like a PDF. Drop a .pdf file.`)
        return
      }
      setError(null)
      try {
        const bytes = await file.arrayBuffer()
        onFile(bytes, file.name)
      } catch {
        setError('Could not read that file. Try again?')
      }
    },
    [onFile],
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      void acceptFile(e.dataTransfer.files[0])
    },
    [acceptFile],
  )

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <nav className="animate-fade-up border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center px-6 py-4">
          <div className="flex items-center gap-2">
            <LogoMark width={28} height={28} className="rounded-md" />
            <span className="font-display text-lg tracking-tight text-slate-900">
              Inks<span className="text-ink-600">PDF</span>
            </span>
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div className="animate-fade-up [animation-delay:80ms]">
            <h1 className="font-display text-4xl text-balance text-slate-900 sm:text-5xl">
              Your PDF, your{' '}
              <span className="relative inline-block">
                ink
                <svg
                  viewBox="0 0 120 14"
                  preserveAspectRatio="none"
                  aria-hidden
                  className="absolute -bottom-1.5 left-0 h-3 w-full text-ink-600"
                >
                  <path
                    d="M2 8c10-6 18 4 28 2c10-4 18 4 28 1c10-4 18 4 28 1c10-3 18 3 26 0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              .
            </h1>
            <p className="mt-4 max-w-md text-lg text-slate-600">
              Add text, draw and sign PDFs — free, no sign-up, and{' '}
              <strong className="text-slate-800">100% in your browser</strong>. Your file never
              leaves this device.
            </p>

            <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {TRUST_BADGES.map(({ icon: Icon, label, desc }) => (
                <li key={label} className="flex items-start gap-2.5">
                  <Icon
                    width={18}
                    height={18}
                    className="mt-0.5 shrink-0 text-ink-600"
                    strokeWidth={1.75}
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{label}</p>
                    <p className="text-xs text-slate-500">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="animate-fade-up [animation-delay:160ms]">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a PDF"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => {
                e.preventDefault()
                dragDepth.current += 1
                setDragging(true)
              }}
              onDragLeave={() => {
                dragDepth.current -= 1
                if (dragDepth.current <= 0) setDragging(false)
              }}
              onDrop={onDrop}
              className={`flex w-full cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center shadow-sm transition-colors ${
                dragging
                  ? 'border-sky-500 bg-sky-50'
                  : 'border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50/50'
              }`}
            >
              <FileIcon width={48} height={48} className="text-ink-600" strokeWidth={1.5} />
              <div>
                <p className="text-lg font-semibold text-slate-800">
                  {dragging ? 'Drop it!' : 'Drag & drop your PDF here'}
                </p>
                <p className="mt-1 text-sm text-slate-500">or click to browse your files</p>
              </div>
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

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-col items-center gap-3 text-center sm:flex-row sm:flex-wrap sm:gap-2">
              <p className="text-sm text-slate-500">More tools:</p>
              <a
                href="/merge"
                onClick={(e) => {
                  e.preventDefault()
                  onMergeClick()
                }}
                className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink-800"
              >
                Merge PDFs
              </a>
              <a
                href="/split"
                onClick={(e) => {
                  e.preventDefault()
                  onSplitClick()
                }}
                className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink-800"
              >
                Split PDF
              </a>
              <a
                href="/watermark"
                onClick={(e) => {
                  e.preventDefault()
                  onWatermarkClick()
                }}
                className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink-800"
              >
                Watermark &amp; Numbers
              </a>
            </div>
          </div>
        </div>

        <div className="animate-fade-up mt-12 grid gap-10 [animation-delay:240ms] sm:grid-cols-3 sm:gap-8">
          {HOW_IT_WORKS.map(({ step, title, desc }) => (
            <div key={step}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-white">
                {step}
              </span>
              <p className="font-display mt-3 text-lg text-slate-900">{title}</p>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400">
        <p>© {new Date().getFullYear()} InksPDF. All rights reserved.</p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <a
            href="/terms"
            onClick={(e) => {
              e.preventDefault()
              onTermsClick()
            }}
            className="hover:text-slate-600 hover:underline"
          >
            Terms of Use
          </a>
          <a
            href="/privacy"
            onClick={(e) => {
              e.preventDefault()
              onPrivacyClick()
            }}
            className="hover:text-slate-600 hover:underline"
          >
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  )
}
