import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

// Real-world PDFs (esp. Word/Google Docs exports, or generated documents
// with inline dynamic values like dates) very often split a paragraph into
// MANY separate text-showing operations even with no style change at all —
// e.g. one run per inserted variable, or just per-word kerning runs. Build
// this paragraph the same way: many small regular-weight runs, no bold,
// to see if fragmentation alone (without any style change) still causes
// inconsistent highlight geometry.
const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
const page = doc.addPage([650, 792])
const size = 14
const leftMargin = 40
let y = 700

// Each line built from several separate runs (simulating inserted dynamic
// values like dates, or just fragmented text runs), all regular weight.
const lines = [
  ['Because you both started work recently (you in late ', 'January 2026', ', and your partner in mid-', 'June'],
  ['2026', '), you do not qualify for the Enhanced CPF Housing Grant (', 'EHG', ') due to the requirement'],
  ['for ', '12 months', ' of continuous employment prior to application. However, you completely qualify'],
  ['for the Staggered Downpayment Scheme (as first-timers applying before age ', '30', '). This'],
  ['significantly eases your initial cashflow.'],
]

for (const runs of lines) {
  let x = leftMargin
  for (const t of runs) {
    page.drawText(t, { x, y, size, font, color: rgb(0.1, 0.15, 0.35) })
    x += font.widthOfTextAtSize(t, size)
  }
  y -= size * 1.5
}

const bytes = await doc.save()
writeFileSync(new URL('./paragraph2.pdf', import.meta.url), bytes)
console.log('wrote e2e/paragraph2.pdf')
