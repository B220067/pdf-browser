// Confirms the exported PDF embeds Great Vibes and the text is extractable.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const data = new Uint8Array(readFileSync(join(here, 'fonts-edited.pdf')))
const doc = await getDocument({ data }).promise
const p1 = await doc.getPage(1)
const content = await p1.getTextContent()
const text = content.items.map((i) => i.str).join(' ')
console.log('page1 text:', JSON.stringify(text))
console.log('ASSERT cursive text present:', text.includes('Chloe Lim') ? 'PASS' : 'FAIL')

// Resolve the actual font programs (names live in compressed object streams,
// so a raw byte grep can't see them — ask pdf.js after it parses the page).
await p1.getOperatorList()
const fontNames = []
const ids = [...new Set(content.items.map((i) => i.fontName))]
for (const id of ids) {
  const font = p1.commonObjs.has(id) ? p1.commonObjs.get(id) : null
  if (font) fontNames.push(font.name)
}
console.log('embedded/used font names:', fontNames)
console.log(
  'ASSERT GreatVibes among page fonts:',
  fontNames.some((n) => /GreatVibes|Great.?Vibes/i.test(n)) ? 'PASS' : 'FAIL',
)
