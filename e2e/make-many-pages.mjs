// Large-page-count fixture to verify windowed thumbnail rendering.
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAGE_COUNT = 60

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
for (let i = 1; i <= PAGE_COUNT; i++) {
  const p = doc.addPage([612, 792])
  p.drawText(`PAGE ${i}`, { x: 60, y: 700, size: 32, font })
}
const bytes = await doc.save()
const out = join(dirname(fileURLToPath(import.meta.url)), 'many-pages.pdf')
writeFileSync(out, bytes)
console.log('wrote', out, `(${PAGE_COUNT} pages)`)
