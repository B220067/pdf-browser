// Verifies: font list is Arial/Times/Courier/Great Vibes (no Helvetica),
// cursive text exports correctly (lazy fontkit embed path), and preset
// color swatches work for text, pen, and the signature modal.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'sample.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(600)
const box = await page.locator('[data-page="0"]').boundingBox()

// ---- font dropdown contents ----
await page.getByTitle(/Add text box/).click()
await page.mouse.click(box.x + 150, box.y + 150)
await page.waitForTimeout(200)
const options = await page.getByLabel('Font family').locator('option').allTextContents()
console.log('font options:', options)
console.log('ASSERT Helvetica removed:', !options.includes('Helvetica') ? 'PASS' : 'FAIL')
console.log('ASSERT cursive available:', options.some((o) => o.includes('Great Vibes')) ? 'PASS' : 'FAIL')

// ---- type a name in Great Vibes, pick a preset red swatch ----
await page.getByLabel('Font family').selectOption({ label: 'Great Vibes (cursive)' })
await page.keyboard.type('Chloe Lim', { delay: 10 })
const swatches = page.locator('[role=group][aria-label="Text color"] button')
console.log('text color swatch count:', await swatches.count())
await swatches.nth(2).click() // red preset
await page.waitForTimeout(150)
const style = await page.locator('textarea').first().evaluate((el) => ({
  fontFamily: getComputedStyle(el).fontFamily,
  color: getComputedStyle(el).color,
}))
console.log('textarea style:', style)
console.log('ASSERT cursive font applied on screen:', style.fontFamily.includes('Great Vibes') ? 'PASS' : 'FAIL')
console.log('ASSERT preset red applied:', style.color === 'rgb(220, 38, 38)' ? 'PASS' : 'FAIL')

// ---- pen swatches exist in draw mode ----
await page.getByTitle('Draw / sign (D)').click()
const penSwatches = await page.locator('[role=group][aria-label="Pen color"] button').count()
console.log('pen color swatches:', penSwatches, penSwatches === 4 ? 'PASS' : 'FAIL')

// ---- signature modal swatches ----
await page.getByTitle(/Draw a signature to reuse/).click()
await page.waitForSelector('[role=dialog]')
const sigSwatches = await page.locator('[role=group][aria-label="Signature ink color"] button').count()
console.log('signature ink swatches:', sigSwatches, sigSwatches === 4 ? 'PASS' : 'FAIL')
await page.getByRole('button', { name: 'Cancel' }).click()

// ---- export with the cursive text (exercises lazy fontkit embed) ----
const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'fonts-edited.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())
await browser.close()
