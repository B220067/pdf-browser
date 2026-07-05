// Fixture with all four AcroForm field kinds on page 1 of 2 (two pages so
// the form + page-reorder interplay can be tested).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)

const page = doc.addPage([612, 792])
page.drawText('TEST FORM', { x: 50, y: 730, size: 22, font })
page.drawText('Name:', { x: 50, y: 655, size: 12, font })
page.drawText('I agree:', { x: 50, y: 615, size: 12, font })
page.drawText('Color:', { x: 50, y: 575, size: 12, font })
page.drawText('Size S / M:', { x: 50, y: 535, size: 12, font })

const form = doc.getForm()

const nameField = form.createTextField('applicant.name')
nameField.addToPage(page, { x: 130, y: 645, width: 220, height: 20, font, borderColor: rgb(0.7, 0.7, 0.7) })

const agree = form.createCheckBox('applicant.agree')
agree.addToPage(page, { x: 130, y: 608, width: 16, height: 16, borderColor: rgb(0.7, 0.7, 0.7) })

const color = form.createDropdown('applicant.color')
color.addOptions(['Red', 'Green', 'Blue'])
color.addToPage(page, { x: 130, y: 565, width: 120, height: 20, font, borderColor: rgb(0.7, 0.7, 0.7) })

const size = form.createRadioGroup('applicant.size')
size.addOptionToPage('S', page, { x: 130, y: 528, width: 16, height: 16 })
size.addOptionToPage('M', page, { x: 170, y: 528, width: 16, height: 16 })

const page2 = doc.addPage([612, 792])
page2.drawText('SECOND PAGE', { x: 50, y: 730, size: 22, font })

const bytes = await doc.save()
const out = join(dirname(fileURLToPath(import.meta.url)), 'form-test.pdf')
writeFileSync(out, bytes)
console.log('wrote', out, bytes.length, 'bytes')
