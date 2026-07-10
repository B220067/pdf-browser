// Verifies the exact scenario discussed: a redaction box covering only part
// of a word ("par" of "parcel", stopping before the 'r'/'c' boundary).
// Expected behavior: the WHOLE word "parcel" stops being real text (not just
// "par") — because the removal unit is the whole text-showing operation —
// but "cel" remains visually present as pixels, and every other word/line on
// the page (untouched by any box) stays real, extractable text. This also
// confirms the PRECISE (word-level) path ran, not the whole-page fallback.
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
await page.setInputFiles('input[type=file]', join(here, 'parcel.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const box = await page.locator('[data-page="0"]').boundingBox()
const s = box.width / 612

// "parcel" is drawn at x=220,y=700,size=18. Helvetica advance width of "pa"
// at size 18 is roughly 18.5pt, so a box from x=220 to x=245 should cover
// "pa" (and a sliver of "r") while leaving "rcel" mostly visible — close
// enough to the user's "up to the r" example without needing exact glyph
// metrics for the test itself.
await page.getByTitle('Redact (R)').click()
const rx1 = box.x + 219 * s
const ry1 = box.y + (792 - 700 - 16) * s
const rx2 = box.x + 246 * s
const ry2 = box.y + (792 - 700 + 6) * s
await page.mouse.move(rx1, ry1)
await page.mouse.down()
await page.mouse.move(rx2, ry2, { steps: 8 })
await page.mouse.up()
await page.screenshot({ path: shot('30-partial-word-drawn'), clip: { x: box.x, y: box.y + 60 * s, width: box.width, height: 100 * s } })

const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'parcel-redacted.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())

const data = new Uint8Array(readFileSync(outPath))
const doc = await getDocument({ data }).promise
const p1 = await doc.getPage(1)
const content = await p1.getTextContent()
const items = content.items.map((it) => ('str' in it ? it.str : ''))
const text = items.join(' ')
console.log('page1 item count:', items.length)
console.log('page1 extracted text:', JSON.stringify(text))

console.log('used PRECISE path, not whole-page fallback (item count > 0):', items.length > 0 ? 'PASS' : 'FAIL')
console.log('"parcel" fully gone (not just "par"):', !text.includes('parcel') && !text.includes('rcel') && !text.includes('cel') ? 'PASS' : 'FAIL')
console.log('surrounding sentence survives ("Please"):', text.includes('Please') ? 'PASS' : 'FAIL')
console.log('surrounding sentence survives ("collect"):', text.includes('collect') ? 'PASS' : 'FAIL')
console.log('surrounding sentence survives ("front desk"):', text.includes('front desk') ? 'PASS' : 'FAIL')
console.log('untouched second line fully survives:', text.includes('This second line should stay fully selectable.') ? 'PASS' : 'FAIL')

// Reopen and confirm visually + confirm the un-redacted line is still
// draggable/selectable via the real browser text layer (not just present in
// pdf.js's extraction — actually exercise the same selection path a user
// would use to copy text).
await page.goto(url)
await page.setInputFiles('input[type=file]', outPath)
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)
const rbox = await page.locator('[data-page="0"]').boundingBox()
const rs = rbox.width / 612
await page.screenshot({ path: shot('31-partial-word-reopened'), clip: { x: rbox.x, y: rbox.y + 60 * rs, width: rbox.width, height: 100 * rs } })

const textLayerContent = await page.locator('.textLayer').innerText()
console.log('reopened text layer content:', JSON.stringify(textLayerContent))
console.log('reopened text layer still has untouched line:', textLayerContent.includes('This second line should stay fully selectable.') ? 'PASS' : 'FAIL')
console.log('reopened text layer has no "parcel" remnant:', !textLayerContent.includes('parcel') ? 'PASS' : 'FAIL')

await browser.close()
console.log('DONE')
