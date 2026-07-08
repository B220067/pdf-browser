import { useCallback, useEffect, useState } from 'react'
import { DropZone } from './components/DropZone'
import { MergePdfs } from './components/MergePdfs'
import { PdfEditor } from './components/PdfEditor'
import { SplitPdf } from './components/SplitPdf'
import { WatermarkPdf } from './components/WatermarkPdf'

interface LoadedFile {
  /** Monotonic id so re-opening the same file fully remounts the editor. */
  id: number
  bytes: ArrayBuffer
  name: string
}

export type Screen = 'home' | 'merge' | 'split' | 'watermark'

/** Each tool gets a real, bookmarkable, indexable URL — not just in-memory state. */
const PATH_TO_SCREEN: Record<string, Screen> = {
  '/': 'home',
  '/merge': 'merge',
  '/split': 'split',
  '/watermark': 'watermark',
}
export const SCREEN_TO_PATH: Record<Screen, string> = {
  home: '/',
  merge: '/merge',
  split: '/split',
  watermark: '/watermark',
}

const SEO: Record<Screen, { title: string; description: string }> = {
  home: {
    title: 'InksPDF — free in-browser PDF editor',
    description:
      'Free online PDF editor that runs 100% in your browser. Add text, draw, sign and download — your file never leaves your device.',
  },
  merge: {
    title: 'Merge PDF files online free — InksPDF',
    description:
      'Combine multiple PDFs into one file, in any order, entirely in your browser. No upload, no signup, no file size limit.',
  },
  split: {
    title: 'Split & extract PDF pages online free — InksPDF',
    description:
      'Pull specific pages out of a PDF or split it into separate files, entirely in your browser. No upload, no signup.',
  },
  watermark: {
    title: 'Add watermark & page numbers to a PDF — InksPDF',
    description:
      'Stamp a text watermark and page numbers across every page of a PDF, entirely in your browser. No upload, no signup.',
  },
}

function screenFromPath(pathname: string): Screen {
  // Tolerate a trailing slash (e.g. "/merge/") so the rendered screen always
  // matches what's in the address bar, not just the exact literal path.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return PATH_TO_SCREEN[normalized] ?? 'home'
}

export default function App() {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [screen, setScreenState] = useState<Screen>(() => screenFromPath(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setScreenState(screenFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (file) {
      document.title = `${file.name} — InksPDF`
      return
    }
    const meta = SEO[screen]
    document.title = meta.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
  }, [screen, file])

  const navigate = useCallback((next: Screen) => {
    const path = SCREEN_TO_PATH[next]
    if (window.location.pathname !== path) window.history.pushState({ ink: true }, '', path)
    setScreenState(next)
  }, [])

  // "Back" prefers real browser back navigation (so the native Back button
  // doesn't loop into the tool you just left) when the current entry is one
  // we pushed ourselves; falls back to a plain pushState for a direct-loaded
  // tool URL, which has no prior in-app history entry to pop.
  const goBack = useCallback(() => {
    if ((window.history.state as { ink?: boolean } | null)?.ink) window.history.back()
    else navigate('home')
  }, [navigate])

  const handleFile = useCallback((bytes: ArrayBuffer, name: string) => {
    setFile((prev) => ({ id: (prev?.id ?? 0) + 1, bytes, name }))
  }, [])

  if (file) {
    return (
      <PdfEditor
        key={file.id}
        bytes={file.bytes}
        fileName={file.name}
        onClose={() => {
          setFile(null)
          // The screen behind the editor may have drifted via browser
          // back/forward while it was open; force it back in sync with home.
          navigate('home')
        }}
      />
    )
  }

  if (screen === 'merge') return <MergePdfs onBack={goBack} />
  if (screen === 'split') return <SplitPdf onBack={goBack} />
  if (screen === 'watermark') return <WatermarkPdf onBack={goBack} />

  return (
    <DropZone
      onFile={handleFile}
      onMergeClick={() => navigate('merge')}
      onSplitClick={() => navigate('split')}
      onWatermarkClick={() => navigate('watermark')}
    />
  )
}
