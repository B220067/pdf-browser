import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DropZone } from './components/DropZone'
import seoRoutes from './seo-routes.json'

// Route-based code splitting: DropZone (the homepage, and what most new
// visitors from search land on) stays in the main bundle since it's shown
// immediately and is lightweight on its own. Everything else — especially
// PdfEditor, which pulls in the whole pdf.js/pdf-lib editing engine — only
// needs to load once a visitor actually navigates there, so it's excluded
// from the bundle everyone pays for on first load.
const PdfEditor = lazy(() => import('./components/PdfEditor').then((m) => ({ default: m.PdfEditor })))
const MergePdfs = lazy(() => import('./components/MergePdfs').then((m) => ({ default: m.MergePdfs })))
const SplitPdf = lazy(() => import('./components/SplitPdf').then((m) => ({ default: m.SplitPdf })))
const WatermarkPdf = lazy(() => import('./components/WatermarkPdf').then((m) => ({ default: m.WatermarkPdf })))
const TermsOfUse = lazy(() => import('./components/TermsOfUse').then((m) => ({ default: m.TermsOfUse })))
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })))

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
    </div>
  )
}

interface LoadedFile {
  /** Monotonic id so re-opening the same file fully remounts the editor. */
  id: number
  bytes: ArrayBuffer
  name: string
}

export type Screen = 'home' | 'merge' | 'split' | 'watermark' | 'terms' | 'privacy'

const SITE_URL = 'https://inkspdf.com'

/** Each tool gets a real, bookmarkable, indexable URL — not just in-memory state.
 *  Paths (including the trailing slash on non-home routes, which matches what
 *  GitHub Pages actually serves as the canonical 200 for a directory-style
 *  route — a bare "/merge" 301s to "/merge/") come from seo-routes.json, the
 *  same source scripts/postbuild.mjs uses, so the canonical tag baked into
 *  the static HTML always matches the one React sets after hydration. */
export const SCREEN_TO_PATH: Record<Screen, string> = Object.fromEntries(
  Object.entries(seoRoutes).map(([screen, route]) => [screen, route.path]),
) as Record<Screen, string>

// screenFromPath() below strips any trailing slash before this lookup, so
// keys here stay in bare form regardless of what SCREEN_TO_PATH serves.
const PATH_TO_SCREEN: Record<string, Screen> = {
  '/': 'home',
  '/merge': 'merge',
  '/split': 'split',
  '/watermark': 'watermark',
  '/terms': 'terms',
  '/privacy': 'privacy',
}

// Single source of truth shared with scripts/postbuild.mjs, so the
// pre-hydration static HTML served to non-JS crawlers (most AI bots included)
// matches what React sets after hydration instead of drifting from it.
const SEO: Record<Screen, { title: string; description: string }> = seoRoutes

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
    // Self-referencing canonical per route — the URL doesn't change while a
    // file is open (see the `file` branch above), so this only needs to run
    // here, keyed off the actual route.
    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute('href', `${SITE_URL}${SCREEN_TO_PATH[screen]}`)
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

  let content: ReactNode
  if (file) {
    content = (
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
  } else if (screen === 'merge') {
    content = <MergePdfs onBack={goBack} />
  } else if (screen === 'split') {
    content = <SplitPdf onBack={goBack} />
  } else if (screen === 'watermark') {
    content = <WatermarkPdf onBack={goBack} />
  } else if (screen === 'terms') {
    content = <TermsOfUse onBack={goBack} />
  } else if (screen === 'privacy') {
    content = <PrivacyPolicy onBack={goBack} />
  } else {
    content = (
      <DropZone
        onFile={handleFile}
        onMergeClick={() => navigate('merge')}
        onSplitClick={() => navigate('split')}
        onWatermarkClick={() => navigate('watermark')}
        onTermsClick={() => navigate('terms')}
        onPrivacyClick={() => navigate('privacy')}
      />
    )
  }

  // Only the lazy screens above actually suspend — DropZone is eager and
  // renders immediately, so most visitors never see the fallback at all.
  return <Suspense fallback={<RouteLoadingFallback />}>{content}</Suspense>
}
