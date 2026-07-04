// Generates a 2-page sample PDF: page 1 normal, page 2 with /Rotate 90,
// so we can verify the rotated-page coordinate mapping too.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)

const p1 = doc.addPage([612, 792])
p1.drawText('SAMPLE CONTRACT — page 1', { x: 60, y: 720, size: 20, font })
p1.drawText('Signature: ____________________', { x: 60, y: 200, size: 14, font })
p1.drawRectangle({ x: 50, y: 50, width: 512, height: 692, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 })

const p2 = doc.addPage([612, 792])
p2.setRotation(degrees(90))
p2.drawText('ROTATED PAGE (Rotate 90) — page 2', { x: 60, y: 500, size: 20, font, rotate: degrees(90) })

const bytes = await doc.save()
const out = join(dirname(fileURLToPath(import.meta.url)), 'sample.pdf')
writeFileSync(out, bytes)
console.log('wrote', out, bytes.length, 'bytes')
