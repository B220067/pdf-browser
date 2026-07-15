// Fixture reproducing the layout shape of a real-world exported document
// (e.g. Chrome print-to-PDF): a large bold heading with a paragraph
// TIGHTLY below it. The tight spacing is the point — the heading's loose
// text-layer line box plus search padding reaches into the paragraph's
// ink, which is exactly the condition that made the canvas word-scan
// silently fail (fused ink bands) and fall back to misaligned
// char-count boxes on a real user document, while the roomy title.pdf
// fixture kept passing.
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
// Body line starts ~22pt below the heading baseline — tight, like a real
// exported document's heading-to-paragraph spacing.
page.drawText('Since you are aiming for a mid-floor unit right in the middle of the range, we will', {
  x: 40,
  y: 678,
  size: 14,
  font: regular,
  color: rgb(0.1, 0.1, 0.1),
})
page.drawText('base all calculations on a purchase price of $746,800 going 50-50 as your share.', {
  x: 40,
  y: 658,
  size: 14,
  font: regular,
  color: rgb(0.1, 0.1, 0.1),
})

const bytes = await doc.save()
writeFileSync(new URL('./title-tight.pdf', import.meta.url), bytes)
console.log('wrote e2e/title-tight.pdf')
