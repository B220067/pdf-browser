// Verifies signature resize: select a stamped two-stroke signature, drag
// the corner handle outward, and confirm the group scales uniformly
// (bbox grows, both strokes scale, width scales), stays undoable, and the
// enlarged size survives export.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'sample.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(600)
const box = await page.locator('[data-page="0"]').boundingBox()

// Capture a two-stroke signature and stamp it.
await page.getByTitle(/Draw a signature to reuse/).click()
await page.waitForSelector('[role=dialog]')
const sig = await page.locator('[role=dialog] svg.cursor-crosshair').boundingBox()
await page.mouse.move(sig.x + 20, sig.y + sig.height / 2)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(sig.x + 20 + (i * (sig.width / 2 - 30)) / 8, sig.y + sig.height / 2 + Math.sin(i) * 12, { steps: 1 })
}
await page.mouse.up()
await page.mouse.move(sig.x + sig.width / 2 + 20, sig.y + sig.height / 2)
await page.mouse.down()
await page.mouse.move(sig.x + sig.width - 20, sig.y + sig.height / 2 - 10, { steps: 4 })
await page.mouse.up()
await page.getByRole('button', { name: 'Save signature' }).click()
await page.waitForTimeout(200)
await page.mouse.click(box.x + box.width / 2, box.y + 350)
await page.waitForTimeout(200)

// Select it.
await page.getByTitle('Select & move (V)').click()
await page.mouse.click(box.x + box.width / 2 - 60, box.y + 350)
await page.waitForTimeout(200)

const frame = page.locator('[data-page="0"] svg rect[stroke-dasharray]')
const handle = page.locator('[data-page="0"] svg rect[rx]')
console.log('selection frame:', (await frame.count()) === 1 ? 'PASS' : 'FAIL')
console.log('resize handle:', (await handle.count()) === 1 ? 'PASS' : 'FAIL')

const frameBefore = await frame.boundingBox()
const paths = page.locator('[data-page="0"] svg path[stroke]:not([stroke="transparent"])')
const widthsBefore = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('stroke-width')))
const dBefore = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))

// Drag the handle outward (down-right) to enlarge.
const hb = await handle.boundingBox()
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
await page.mouse.down()
await page.mouse.move(hb.x + 160, hb.y + 110, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)

const frameAfter = await frame.boundingBox()
const widthsAfter = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('stroke-width')))
const dAfter = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))
console.log('frame growth: x', (frameAfter.width / frameBefore.width).toFixed(2), 'y', (frameAfter.height / frameBefore.height).toFixed(2))

// Uniformity must be judged on the stroke GEOMETRY (the frame adds a fixed
// padding that skews ratios for wide, short signatures). Parse the path
// coordinates and compare content bbox growth on each axis.
const pathBbox = (ds) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of ds) {
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number)
    for (let i = 0; i < nums.length; i += 2) {
      minX = Math.min(minX, nums[i]); maxX = Math.max(maxX, nums[i])
      minY = Math.min(minY, nums[i + 1]); maxY = Math.max(maxY, nums[i + 1])
    }
  }
  return { w: maxX - minX, h: maxY - minY }
}
const sigBefore = pathBbox(dBefore.slice(0, 2))
const sigAfter = pathBbox(dAfter.slice(0, 2))
const scaleX = sigAfter.w / sigBefore.w
const scaleY = sigAfter.h / sigBefore.h
console.log('content scale: x', scaleX.toFixed(3), 'y', scaleY.toFixed(3))
console.log('RESULT signature grew:', scaleX > 1.3 ? 'PASS' : 'FAIL')
console.log('RESULT uniform (aspect kept):', Math.abs(scaleX - scaleY) < 0.02 * scaleX ? 'PASS' : 'FAIL')
console.log('RESULT both strokes changed:', dBefore[0] !== dAfter[0] && dBefore[1] !== dAfter[1] ? 'PASS' : 'FAIL')
console.log(
  'RESULT stroke width scaled:',
  Number(widthsAfter[0]) > Number(widthsBefore[0]) ? 'PASS' : 'FAIL',
  `(${widthsBefore[0]} -> ${widthsAfter[0]})`,
)

// One undo reverts the whole resize.
await page.getByTitle('Undo (Ctrl+Z)').click()
await page.waitForTimeout(200)
const dUndone = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))
console.log('RESULT one undo restores size:', dUndone[0] === dBefore[0] && dUndone[1] === dBefore[1] ? 'PASS' : 'FAIL')

// Redo, export, reopen: enlarged signature ink should cover a wider area.
await page.getByTitle('Redo (Ctrl+Shift+Z)').click()
await page.waitForTimeout(200)
const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'resize-edited.pdf')
await dl.saveAs(outPath)

await page.goto(url)
await page.setInputFiles('input[type=file]', outPath)
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)
const bluePixels = await page.evaluate(() => {
  const canvas = document.querySelector('[data-page="0"] canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 2] > 150 && data[i + 2] - data[i] > 60 && data[i + 2] - data[i + 1] > 60) count++
  }
  return count
})
console.log('RESULT enlarged signature baked into export (blue px):', bluePixels > 200 ? 'PASS' : 'FAIL', `(${bluePixels})`)

await browser.close()
