// Verifies the new Split PDF tool: extract a range into one file, and split
// a range into separate single-page files. Uses 3page.pdf (ALPHA/BRAVO/CHARLIE).
import { chromium } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:5173/'

async function textOf(pdfPath) {
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await getDocument({ data }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  return { numPages: doc.numPages, pages }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.getByRole('link', { name: 'Split PDF' }).click()
await page.setInputFiles('input[type=file]', join(here, '3page.pdf'))
await page.waitForSelector('text=3 pages')
console.log('page count detected: PASS')

await page.getByPlaceholder(/e.g. 1-3/).fill('1-2')

// ---- Extract as one PDF ----
const dl1Promise = page.waitForEvent('download')
await page.getByRole('button', { name: 'Extract as one PDF' }).click()
const dl1 = await dl1Promise
const extractPath = join(here, 'split-extract.pdf')
await dl1.saveAs(extractPath)
const extracted = await textOf(extractPath)
console.log('extracted numPages:', extracted.numPages, extracted.numPages === 2 ? 'PASS' : 'FAIL')
console.log('extracted page1 has ALPHA:', extracted.pages[0].includes('ALPHA') ? 'PASS' : 'FAIL')
console.log('extracted page2 has BRAVO:', extracted.pages[1].includes('BRAVO') ? 'PASS' : 'FAIL')

// ---- Split into separate PDFs ----
const downloads = []
page.on('download', (d) => downloads.push(d))
await page.getByRole('button', { name: 'Split into separate PDFs' }).click()
await page.waitForTimeout(1000)
console.log('separate download count:', downloads.length, downloads.length === 2 ? 'PASS' : 'FAIL')
for (let i = 0; i < downloads.length; i++) {
  const p = join(here, `split-part-${i}.pdf`)
  await downloads[i].saveAs(p)
  const t = await textOf(p)
  console.log(`part ${i} (${downloads[i].suggestedFilename()}): numPages=${t.numPages}, text="${t.pages[0].trim()}"`)
}

await browser.close()
