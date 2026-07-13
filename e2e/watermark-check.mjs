// Verifies the new Watermark & Numbers tool: default "CONFIDENTIAL" watermark
// plus page numbers get baked onto every page. Uses 3page.pdf.
import { chromium } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.getByRole('link', { name: 'Watermark & Numbers' }).click()
// WatermarkPdf is a lazily-loaded chunk (see App.tsx) — wait for it to
// actually mount before touching its file input, or this can race the
// Suspense fallback and hit the homepage's own (still-transitioning-out)
// input.
await page.waitForSelector('h1:has-text("Watermark")')
await page.setInputFiles('input[type=file]', join(here, '3page.pdf'))
await page.waitForSelector('text=3page.pdf')

// Watermark is on by default with "CONFIDENTIAL"; enable page numbers too.
await page.getByText('Page numbers', { exact: true }).click()

const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: 'Apply & Download' }).click()
const dl = await dlPromise
const outPath = join(here, 'watermark-out.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())

const data = new Uint8Array(readFileSync(outPath))
const doc = await getDocument({ data }).promise
console.log('numPages:', doc.numPages, doc.numPages === 3 ? 'PASS' : 'FAIL')

for (let i = 1; i <= doc.numPages; i++) {
  const content = await (await doc.getPage(i)).getTextContent()
  const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' | ')
  console.log(`--- page ${i} ---`)
  console.log(text)
  const hasWatermark = text.includes('CONFIDENTIAL')
  const hasNumber = text.includes(`Page ${i} of 3`)
  console.log(`page ${i} watermark present:`, hasWatermark ? 'PASS' : 'FAIL')
  console.log(`page ${i} number present:`, hasNumber ? 'PASS' : 'FAIL')
}

await browser.close()
