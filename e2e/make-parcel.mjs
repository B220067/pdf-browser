// Fixture for testing partial-word redaction: a single word "parcel" drawn
// as one Tj call (not split per-word), plus a sentence around it, so the
// redaction unit under test is genuinely "one word" not "one pre-split run".
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
const page = doc.addPage([612, 792])
page.drawText('Please collect the', { x: 40, y: 700, size: 18, font })
page.drawText('parcel', { x: 220, y: 700, size: 18, font })
page.drawText('from the front desk.', { x: 280, y: 700, size: 18, font })
page.drawText('This second line should stay fully selectable.', { x: 40, y: 660, size: 14, font })
const bytes = await doc.save()
writeFileSync(new URL('./parcel.pdf', import.meta.url), bytes)
console.log('wrote e2e/parcel.pdf')
