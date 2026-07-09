import { LogoMark } from './icons'

interface PrivacyPolicyProps {
  onBack: () => void
}

export function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
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
        <h1 className="font-display text-3xl text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-400">Last updated July 2026</p>

        <div className="mt-8 flex flex-col gap-6 text-slate-700 leading-relaxed">
          <p>InksPDF doesn't have a server behind it, so this is a shorter policy than most.</p>

          <div>
            <h2 className="font-display text-xl text-slate-900">Your files never leave your device</h2>
            <p className="mt-2">
              Unlike most other online PDF editors, every tool on this site runs entirely in your
              browser using open-source libraries. When you open a PDF here, it's read straight off
              your device into your browser's memory. It's never uploaded anywhere so no one else ever
              sees it.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl text-slate-900">A little analytics, nothing invasive</h2>
            <p className="mt-2">
              I use Cloudflare Web Analytics to get a rough sense of how many people visit InksPDF.
              It's cookie-free, doesn't track you across other sites, and doesn't know who you are: just
              aggregate numbers like visit counts. There are no Google Analytics, no ad trackers, and
              nothing watching what you click or how long you spend on any tool.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl text-slate-900">No accounts, no personal info</h2>
            <p className="mt-2">
              There's nothing to sign up for, so no email address, password, or personal details are
              being collected.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl text-slate-900">One thing outside of my control</h2>
            <p className="mt-2">
              Like every other website, the infrastructure that serves InksPDF automatically keeps
              basic connection logs (things like IP address and browser type) for every visit. InksPDF
              has access to none of that.
            </p>
          </div>

          <p>
            If any of this ever changes, I'll update this page to say so clearly. Transparency is my
            utmost priority.
          </p>

          <p>
            Cheers,
            <br />
            InksPDF developer
          </p>
        </div>
      </main>
    </div>
  )
}
