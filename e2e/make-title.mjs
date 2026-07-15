// Fixture for diagnosing text-layer alignment on a large BOLD heading drawn
// as one single Tj call (mirrors "Financial Blueprint for Redhill Peaks"
// style headings) — pdf.js's text layer approximates bold/large runs with a
// generic fallback font, which is documented (see PdfPage.tsx) to drift
// further from the true glyph positions than it does for small regular text.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const doc = await PDFDocument.create()
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const regular = await doc.embedFont(StandardFonts.Helvetica)
const page = doc.addPage([650, 792])

page.drawText('Financial Blueprint for Redhill Peaks', {
  x: 40,
  y: 700,
  size: 28,
  font: bold,
  color: rgb(0.15, 0.1, 0.05),
})
page.drawText('Since you are aiming for a mid-floor unit, we will base all calculations on price.', {
  x: 40,
  y: 650,
  size: 14,
  font: regular,
  color: rgb(0.1, 0.1, 0.1),
})

const bytes = await doc.save()
writeFileSync(new URL('./title.pdf', import.meta.url), bytes)
console.log('wrote e2e/title.pdf')
