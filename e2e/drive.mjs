// Drives the built app end-to-end in headless Chromium (tall viewport so
// whole pages are inside the clickable area).
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 2600 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'sample.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1200)

const box1 = await page.locator('[data-page="0"]').boundingBox()
console.log('page1 box:', JSON.stringify(box1))
const s = box1.width / 612 // displayed pt → screen px

// ---- text box next to the "Signature:" line (PDF y=200 → displayed v=592) ----
await page.getByTitle('Add text box (T)').click()
await page.mouse.click(box1.x + 200 * s, box1.y + 585 * s)
await page.keyboard.type('Chloe Lim', { delay: 15 })

// ---- freehand squiggle above the line ----
await page.getByTitle('Draw / sign (D)').click()
const sx = box1.x + 330 * s
const sy = box1.y + 570 * s
await page.mouse.move(sx, sy)
await page.mouse.down()
for (let i = 1; i <= 30; i++) {
  await page.mouse.move(sx + i * 3 * s, sy + Math.sin(i / 3) * 12 * s, { steps: 1 })
}
await page.mouse.up()
await page.screenshot({ path: shot('10-edits-p1'), clip: { x: box1.x, y: box1.y + 400 * s, width: box1.width, height: 300 * s } })

// ---- text on the ROTATED page 2 ----
const p2 = page.locator('[data-page="1"]')
await p2.scrollIntoViewIfNeeded()
await page.waitForTimeout(900)
const box2 = await p2.boundingBox()
console.log('page2 box:', JSON.stringify(box2))
const s2 = box2.width / 792
await page.getByTitle('Add text box (T)').click()
await page.mouse.click(box2.x + 150 * s2, box2.y + 150 * s2)
await page.keyboard.type('ROTATION TEST', { delay: 15 })
await page.screenshot({ path: shot('11-edits-p2'), clip: { x: box2.x, y: Math.max(box2.y, 0), width: box2.width, height: 350 * s2 } })

// ---- probes: escape deselect, undo shortcut doesn't eat the text ----
await page.keyboard.press('Escape')
await page.keyboard.press('v')

// ---- download ----
const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'edited.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())

// ---- reopen edited.pdf: edits must now come from the file itself ----
await page.goto(url)
await page.setInputFiles('input[type=file]', outPath)
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1500)
const rbox1 = await page.locator('[data-page="0"]').boundingBox()
const rs = rbox1.width / 612
await page.screenshot({ path: shot('12-reopened-p1'), clip: { x: rbox1.x, y: rbox1.y + 400 * rs, width: rbox1.width, height: 300 * rs } })
const rp2 = page.locator('[data-page="1"]')
await rp2.scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)
const rbox2 = await rp2.boundingBox()
const rs2 = rbox2.width / 792
await page.screenshot({ path: shot('13-reopened-p2'), clip: { x: rbox2.x, y: Math.max(rbox2.y, 0), width: rbox2.width, height: 350 * rs2 } })

await browser.close()
console.log('DONE')
