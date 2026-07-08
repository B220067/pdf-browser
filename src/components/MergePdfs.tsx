import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { isPdf } from '../lib/isPdf'
import { mergePdfs, UnmergeableFileError } from '../lib/mergePdfs'
import { downloadBytes } from '../lib/savePdf'
import { LogoMark, TrashIcon } from './icons'

interface MergePdfsProps {
  onBack: () => void
}

export function MergePdfs({ onBack }: MergePdfsProps) {
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming)
    if (list.length === 0) return
    const nonPdf = list.find((f) => !isPdf(f))
    if (nonPdf) {
      setError(`"${nonPdf.name}" doesn't look like a PDF.`)
      return
    }
    setError(null)
    setFiles((prev) => [...prev, ...list])
  }, [])

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index))

  const moveFile = (index: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }

  const handleMerge = useCallback(async () => {
    if (files.length < 2 || merging) return
    setMerging(true)
    setError(null)
    try {
      const bytes = await mergePdfs(files)
      downloadBytes(bytes, 'merged.pdf')
    } catch (err) {
      setError(
        err instanceof UnmergeableFileError
          ? err.message
          : 'Could not merge these files. One of them may be corrupted.',
      )
    } finally {
      setMerging(false)
    }
  }, [files, merging])

  return (
    <div className="min-h-screen bg-slate-100">
      <nav className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
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

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-3xl text-slate-900">Merge PDFs</h1>
        <p className="mt-2 text-slate-600">
          Combine multiple PDFs into one file, in the order below — still 100% in your browser.
        </p>

        <div
          role="button"
          tabIndex={0}
          aria-label="Add PDFs to merge"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="mt-6 flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition-colors hover:border-sky-400 hover:bg-sky-50/50"
        >
          <p className="font-semibold text-slate-800">Add PDFs</p>
          <p className="text-sm text-slate-500">
            Drag files in, or click to browse — add as many as you need
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {files.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{f.name}</span>
                <button
                  type="button"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => moveFile(i, -1)}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={i === files.length - 1}
                  onClick={() => moveFile(i, 1)}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  title="Remove"
                  onClick={() => removeFile(i)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <TrashIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => void handleMerge()}
          disabled={files.length < 2 || merging}
          className="mt-6 flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {merging ? 'Merging…' : 'Merge & Download'}
        </button>
        {files.length === 1 && (
          <p className="mt-2 text-xs text-slate-400">Add at least one more PDF to merge.</p>
        )}
      </main>
    </div>
  )
}
