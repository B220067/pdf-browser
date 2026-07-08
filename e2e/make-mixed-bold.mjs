import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const doc = await PDFDocument.create()
const regular = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const page = doc.addPage([650, 792])
const size = 14
const leftMargin = 40
let y = 700

const lines = [
  [{ t: 'Since you are aiming for a mid-floor unit right in the middle of the range, we will base all', b: false }],
  [
    { t: 'calculations on a purchase price of ', b: false },
    { t: '$746,800', b: true },
    { t: '. Going 50-50 means your individual share of the', b: false },
  ],
  [
    { t: 'flat is ', b: false },
    { t: '$373,400', b: true },
    { t: '.', b: false },
  ],
]

for (const line of lines) {
  let x = leftMargin
  for (const run of line) {
    const font = run.b ? bold : regular
    page.drawText(run.t, { x, y, size, font, color: rgb(0.1, 0.15, 0.35) })
    x += font.widthOfTextAtSize(run.t, size)
  }
  y -= size * 1.5
}

const bytes = await doc.save()
writeFileSync(new URL('./mixed-bold.pdf', import.meta.url), bytes)
console.log('wrote e2e/mixed-bold.pdf')
