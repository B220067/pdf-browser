import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

// Stress test for cross-line merging: tight (single-spaced, ~1.0x) leading
// with mixed-run lines (regular + bold), to check the line-grouping doesn't
// accidentally fuse two adjacent, genuinely-different lines together.
const doc = await PDFDocument.create()
const regular = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const page = doc.addPage([650, 792])
const size = 14
const leftMargin = 40
let y = 700

const lines = [
  [{ t: 'Line one with some regular text and a ', b: false }, { t: 'bold part', b: true }, { t: ' at the end', b: false }],
  [{ t: 'Line two immediately below, tightly spaced, also ', b: false }, { t: 'bold here', b: true }],
  [{ t: 'Line three right after that, no extra gap at all', b: false }],
]

for (const runs of lines) {
  let x = leftMargin
  for (const run of runs) {
    const font = run.b ? bold : regular
    page.drawText(run.t, { x, y, size, font, color: rgb(0, 0, 0) })
    x += font.widthOfTextAtSize(run.t, size)
  }
  y -= size * 1.0 // tight, single-spaced leading
}

const bytes = await doc.save()
writeFileSync(new URL('./tight-lines.pdf', import.meta.url), bytes)
console.log('wrote e2e/tight-lines.pdf')
