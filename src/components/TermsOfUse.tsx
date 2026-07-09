import { LogoMark } from './icons'

interface TermsOfUseProps {
  onBack: () => void
}

export function TermsOfUse({ onBack }: TermsOfUseProps) {
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
        <h1 className="font-display text-3xl text-slate-900">Terms of Use</h1>
        <p className="mt-2 text-sm text-slate-400">Last updated July 2026</p>

        <div className="mt-8 flex flex-col gap-6 text-slate-700 leading-relaxed">
          <p>Thanks for using InksPDF! Here's what you're agreeing to by using our service.</p>

          <div>
            <h2 className="font-display text-xl text-slate-900">You're free to use it, no payment needed</h2>
            <p className="mt-2">
              InksPDF is free to use for anything you need; be it personal, business or whatever the
              case may be. You don't need to ask permission, sign up for an account, or credit InksPDF
              anywhere. I promise that it will always remain this way.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl text-slate-900">But there's no warranty</h2>
            <p className="mt-2">
              I built and maintain this as a side project on my own, so unfortunately I can't guarantee
              it's bug-free. InksPDF is provided "as is", and I'm not responsible for any damage or data
              loss that comes from using it. If you're editing something important, do keep a copy of
              the original file just in case.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl text-slate-900">Get in touch</h2>
            <p className="mt-2">
              Found a bug or have a feature you wish existed? Let me know at hello@inkspdf.com and I'll
              do my best to sort it out quickly.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl text-slate-900">This might change</h2>
            <p className="mt-2">
              I run this on my own, so I might update the site without much notice. I apologise if new
              features take some getting used to, but hopefully they will be of use to you :)
            </p>
          </div>

          <p>
            That's about it. Thanks for trying it out, and I'm happy to take feedback at
            hello@inkspdf.com!
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
