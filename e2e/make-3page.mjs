// 3-page fixture for page-management tests: each page carries a big label
// so extracted text identifies it unambiguously after delete/reorder.
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
for (const label of ['ALPHA', 'BRAVO', 'CHARLIE']) {
  const p = doc.addPage([612, 792])
  p.drawText(`PAGE ${label}`, { x: 60, y: 700, size: 32, font })
}
const bytes = await doc.save()
const out = join(dirname(fileURLToPath(import.meta.url)), '3page.pdf')
writeFileSync(out, bytes)
console.log('wrote', out)
