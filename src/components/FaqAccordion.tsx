import { useState } from 'react'
import { MinusIcon, PlusIcon } from './icons'

interface FaqAccordionProps {
  items: readonly { q: string; a: string }[]
}

/**
 * Single-open accordion: opening one question closes whatever else was
 * open. Collapsing is a CSS grid-template-rows 0fr/1fr transition — the
 * inner wrapper needs `min-h-0` or the browser's implicit grid-item
 * minimum size (based on content) overrides the 0fr row and the answer
 * never actually collapses.
 */
export function FaqAccordion({ items }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div>
      {items.map(({ q, a }, i) => {
        const open = openIndex === i
        return (
          <div key={q} className="border-b border-slate-200 py-4">
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              aria-expanded={open}
              aria-controls={`faq-answer-${i}`}
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <span className="font-display text-base text-slate-900 sm:text-lg">{q}</span>
              {open ? (
                <MinusIcon width={18} height={18} className="shrink-0 text-ink-600" />
              ) : (
                <PlusIcon width={18} height={18} className="shrink-0 text-ink-600" />
              )}
            </button>
            <div
              id={`faq-answer-${i}`}
              className="grid transition-[grid-template-rows] duration-200 ease-out"
              style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="mt-3 max-w-3xl text-sm text-slate-600">{a}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
