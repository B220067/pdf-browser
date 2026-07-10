// Verifies the live preview while drawing a redaction box: affected words
// get an amber highlight and a tooltip lists them (or warns the whole page
// will be flattened), updating as the box is resized — captured mid-drag,
// before mouseup, so nothing has been committed/saved yet.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'parcel.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const box = await page.locator('[data-page="0"]').boundingBox()
const s = box.width / 612

await page.getByTitle('Redact (R)').click()

// Drag slowly across "parcel" only (leave the rest of the sentence alone),
// pausing mid-drag (before mouseup) to inspect the live preview state.
await page.mouse.move(box.x + 219 * s, box.y + (792 - 700 - 16) * s)
await page.mouse.down()
await page.mouse.move(box.x + 275 * s, box.y + (792 - 700 + 6) * s, { steps: 10 })
await page.waitForTimeout(150)

const preview1 = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  const amber = svg?.querySelectorAll('rect[fill="#f59e0b"]').length ?? 0
  const tooltip = svg?.querySelector('foreignObject div')?.textContent ?? null
  return { amberRectCount: amber, tooltipText: tooltip }
})
console.log('mid-drag over "parcel" only:', JSON.stringify(preview1))
console.log('amber highlight shown while dragging:', preview1.amberRectCount > 0 ? 'PASS' : 'FAIL')
console.log('tooltip mentions "parcel":', preview1.tooltipText?.includes('parcel') ? 'PASS' : 'FAIL')
console.log('tooltip does NOT claim whole-page flatten (unrotated, no image):', !preview1.tooltipText?.includes('flattened') ? 'PASS' : 'FAIL')

await page.screenshot({ path: shot('40-live-preview-parcel'), clip: { x: box.x, y: box.y + 40 * s, width: box.width, height: 120 * s } })

// Now extend the drag further right so it also clips "from" — the tooltip
// should update live to include both words.
await page.mouse.move(box.x + 300 * s, box.y + (792 - 700 + 6) * s, { steps: 10 })
await page.waitForTimeout(150)
const preview2 = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  return svg?.querySelector('foreignObject div')?.textContent ?? null
})
console.log('after extending drag, tooltip:', JSON.stringify(preview2))
console.log('tooltip updated live to include more words:', preview2?.includes('parcel') && preview2 !== preview1.tooltipText ? 'PASS' : 'FAIL')

await page.mouse.up()
await page.waitForTimeout(200)

// Preview must disappear once the drag ends (committed box only, no more amber overlay).
const afterRelease = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  return {
    amberRectCount: svg?.querySelectorAll('rect[fill="#f59e0b"]').length ?? 0,
    tooltipPresent: !!svg?.querySelector('foreignObject'),
  }
})
console.log('preview cleared after mouseup:', !afterRelease.tooltipPresent && afterRelease.amberRectCount === 0 ? 'PASS' : 'FAIL')

// ----- rotated-page case: tooltip should warn about whole-page flattening -----
await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'sample.pdf'))
await page.waitForSelector('[data-page="1"] canvas') // page 2 in sample.pdf is rotated 90
const p2 = page.locator('[data-page="1"]')
await p2.scrollIntoViewIfNeeded()
await page.waitForTimeout(1000)
const box2 = await p2.boundingBox()
await page.getByTitle('Redact (R)').click()
await page.mouse.move(box2.x + 40, box2.y + 40)
await page.mouse.down()
await page.mouse.move(box2.x + 160, box2.y + 90, { steps: 8 })
await page.waitForTimeout(150)
const rotatedPreview = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="1"] svg[data-layer="redact"]')
  return svg?.querySelector('foreignObject div')?.textContent ?? null
})
console.log('rotated-page tooltip:', JSON.stringify(rotatedPreview))
console.log('rotated page warns about whole-page flattening:', rotatedPreview?.includes('flattened') ? 'PASS' : 'FAIL')
await page.mouse.up()

await browser.close()
console.log('DONE')
