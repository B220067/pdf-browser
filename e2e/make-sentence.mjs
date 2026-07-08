import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.HelveticaBold)
const page = doc.addPage([612, 792])

// Real-world PDFs (Word/Google Docs exports especially) very often emit one
// separate text-showing operation per word rather than the whole sentence in
// one call — pdf.js then parses each as its own text item/span. Reproduce
// that here instead of drawing the sentence as a single run.
const words = 'Annex A: Details on Deferred Income Assessment'.split(' ')
const size = 18
let x = 40
const y = 700
for (const word of words) {
  page.drawText(word, { x, y, size, font, color: rgb(0, 0, 0) })
  x += font.widthOfTextAtSize(word + ' ', size)
}

const bytes = await doc.save()
writeFileSync(new URL('./sentence.pdf', import.meta.url), bytes)
console.log('wrote e2e/sentence.pdf (per-word text items)')
