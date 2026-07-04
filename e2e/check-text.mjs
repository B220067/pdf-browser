// Structural assertion: extract text from the downloaded PDF with pdf.js
// and confirm the typed strings were baked into the right pages.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const data = new Uint8Array(readFileSync(join(here, 'edited.pdf')))
const doc = await getDocument({ data }).promise

for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' | ')
  console.log(`--- page ${i} (rotate=${page.rotate}) ---`)
  console.log(text)
}
const p1 = await (await doc.getPage(1)).getTextContent()
const p2 = await (await doc.getPage(2)).getTextContent()
const t1 = p1.items.map((i) => i.str).join(' ')
const t2 = p2.items.map((i) => i.str).join(' ')
console.log('ASSERT page1 has "Chloe Lim":', t1.includes('Chloe Lim') ? 'PASS' : 'FAIL')
console.log('ASSERT page2 has "ROTATION TEST":', t2.includes('ROTATION TEST') ? 'PASS' : 'FAIL')
