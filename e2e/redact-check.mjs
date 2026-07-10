// Verifies the Redact tool actually deletes underlying content, not just
// paints over it. Uses sentence.pdf (known text "Annex A: Details on
// Deferred Income Assessment" at x=40,y=700,size=18 on a 612x792 page,
// baked as separate per-word text items — see make-sentence.mjs).
import { chromium } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'sentence.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const box = await page.locator('[data-page="0"]').boundingBox()
const s = box.width / 612 // displayed pt -> screen px

// Sanity check: the text is actually there and selectable before redacting.
const beforeText = await page.locator('.textLayer').innerText()
console.log('before redaction, text layer has sentence:', beforeText.includes('Annex') ? 'PASS' : 'FAIL')

// ---- draw a redaction box over just "Details on Deferred". By design this
// rasterizes the WHOLE page it's on (see savePdf.ts applyRedactions) — the
// only way to guarantee nothing on that page stays copy/searchable — so the
// check below expects the entire page's text to be gone, not just the box. ----
await page.getByTitle('Redact (R)').click()
const rx1 = box.x + 120 * s
const ry1 = box.y + (792 - 700 - 22) * s // sentence baseline y=700 -> top-left space
const rx2 = box.x + 330 * s
const ry2 = box.y + (792 - 700 + 6) * s
await page.mouse.move(rx1, ry1)
await page.mouse.down()
await page.mouse.move(rx2, ry2, { steps: 8 })
await page.mouse.up()
await page.screenshot({ path: shot('20-redact-drawn'), clip: { x: box.x, y: box.y + 60 * s, width: box.width, height: 120 * s } })

const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'redacted.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())

// ---- structural check: extract text from the SAVED FILE with pdf.js ----
const data = new Uint8Array(readFileSync(outPath))
const doc = await getDocument({ data }).promise
const content = await (await doc.getPage(1)).getTextContent()
console.log('extracted text items on redacted page:', content.items.length)
const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
console.log('extracted text:', JSON.stringify(text))

const noItemsAtAll = content.items.length === 0
const noRedactedWords = !text.includes('Details') && !text.includes('Deferred')
console.log('page has zero extractable text items (page was rasterized):', noItemsAtAll ? 'PASS' : 'FAIL')
console.log('redacted words not recoverable from text layer:', noRedactedWords ? 'PASS' : 'FAIL')

// ---- reopen the saved file in the app and confirm nothing is selectable
// under/around the box, and the box is visibly there ----
await page.goto(url)
await page.setInputFiles('input[type=file]', outPath)
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)
const rbox = await page.locator('[data-page="0"]').boundingBox()
await page.screenshot({ path: shot('21-redacted-reopened'), clip: { x: rbox.x, y: rbox.y + 60 * (rbox.width / 612), width: rbox.width, height: 120 * (rbox.width / 612) } })
const reopenedTextLayer = await page.locator('.textLayer').innerText().catch(() => '')
console.log('reopened file text layer content:', JSON.stringify(reopenedTextLayer))
console.log('reopened file has zero selectable text:', reopenedTextLayer.trim() === '' ? 'PASS' : 'FAIL')

await browser.close()
console.log('DONE')
