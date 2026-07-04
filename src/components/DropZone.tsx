import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { FileIcon } from './icons'

interface DropZoneProps {
  onFile: (bytes: ArrayBuffer, name: string) => void
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export function DropZone({ onFile }: DropZoneProps) {
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 p-6">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Ink<span className="text-sky-500">PDF</span>
        </h1>
        <p className="mt-2 max-w-md text-slate-600">
          Add text, draw and sign PDFs — free, no sign-up, and{' '}
          <strong className="text-slate-800">100% in your browser</strong>. Your file never
          leaves this device.
        </p>
      </header>

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
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-14 text-center transition-colors ${
          dragging
            ? 'border-sky-500 bg-sky-50'
            : 'border-slate-300 bg-white hover:border-sky-400 hover:bg-sky-50/50'
        }`}
      >
        <FileIcon width={48} height={48} className="text-sky-500" strokeWidth={1.5} />
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

      <footer className="mt-10 flex gap-6 text-xs text-slate-400">
        <span>Zero servers</span>
        <span>Zero tracking</span>
        <span>Zero cost</span>
      </footer>
    </div>
  )
}
