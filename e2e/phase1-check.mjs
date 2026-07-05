// Verifies Phase 1: generalized undo/redo (strokes + text, coalesced typing)
// and the reusable signature (capture once, stamp on two pages, survives
// export/reopen).
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

// ---------- UNDO/REDO: strokes ----------
await page.getByTitle('Draw / sign (D)').click()
await page.mouse.move(box.x + 100, box.y + 100)
await page.mouse.down()
await page.mouse.move(box.x + 150, box.y + 130, { steps: 5 })
await page.mouse.up()
let strokeCount = await page.locator('[data-page="0"] svg path[stroke]:not([stroke="transparent"])').count()
console.log('after drawing 1 stroke, count =', strokeCount, strokeCount === 1 ? 'PASS' : 'FAIL')

await page.getByTitle('Undo (Ctrl+Z)').click()
strokeCount = await page.locator('[data-page="0"] svg path[stroke]:not([stroke="transparent"])').count()
console.log('after undo, count =', strokeCount, strokeCount === 0 ? 'PASS' : 'FAIL')

await page.getByTitle('Redo (Ctrl+Shift+Z)').click()
strokeCount = await page.locator('[data-page="0"] svg path[stroke]:not([stroke="transparent"])').count()
console.log('after redo, count =', strokeCount, strokeCount === 1 ? 'PASS' : 'FAIL')

// ---------- UNDO/REDO: coalesced typing ----------
await page.getByTitle(/Add text box/).click()
await page.mouse.click(box.x + 300, box.y + 300)
await page.waitForTimeout(150)
await page.keyboard.type('Hello World', { delay: 15 })
await page.waitForTimeout(150)
let textVal = await page.locator('textarea').first().inputValue()
console.log('typed text:', JSON.stringify(textVal))

await page.getByTitle('Undo (Ctrl+Z)').click()
await page.waitForTimeout(100)
const textareaCountAfterUndo = await page.locator('textarea').count()
const textValAfterUndo = textareaCountAfterUndo > 0 ? await page.locator('textarea').first().inputValue() : null
console.log(
  'after ONE undo: textarea count =',
  textareaCountAfterUndo,
  'value =',
  JSON.stringify(textValAfterUndo),
  textareaCountAfterUndo === 1 && textValAfterUndo === '' ? 'PASS (whole typing session undone at once)' : 'FAIL',
)

await page.getByTitle('Undo (Ctrl+Z)').click()
await page.waitForTimeout(100)
console.log(
  'after SECOND undo: textarea count =',
  await page.locator('textarea').count(),
  (await page.locator('textarea').count()) === 0 ? 'PASS (box itself removed)' : 'FAIL',
)

await page.getByTitle('Redo (Ctrl+Shift+Z)').click()
await page.getByTitle('Redo (Ctrl+Shift+Z)').click()
await page.waitForTimeout(100)
const finalVal = await page.locator('textarea').first().inputValue()
console.log('after two redos, text back to:', JSON.stringify(finalVal), finalVal === 'Hello World' ? 'PASS' : 'FAIL')

// ---------- SIGNATURE: capture + stamp on two pages ----------
await page.getByTitle(/Draw a signature to reuse/).click()
await page.waitForSelector('[role=dialog]')
const sigSvg = page.locator('[role=dialog] svg.cursor-crosshair')
const sigBox = await sigSvg.boundingBox()
await page.mouse.move(sigBox.x + 20, sigBox.y + sigBox.height / 2)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(sigBox.x + 20 + i * (sigBox.width - 40) / 10, sigBox.y + sigBox.height / 2 + Math.sin(i) * 15, { steps: 1 })
}
await page.mouse.up()
await page.getByRole('button', { name: 'Save signature' }).click()
await page.waitForTimeout(200)

const strokesAfterCapture = await page.locator('[data-page="0"] svg path[stroke]:not([stroke="transparent"])').count()
console.log('signature stamped on page 1 immediately after save:', strokesAfterCapture)

// Stamp again on page 2.
const page2 = page.locator('[data-page="1"]')
await page2.scrollIntoViewIfNeeded()
await page.waitForTimeout(500)
const box2 = await page2.boundingBox()
await page.mouse.click(box2.x + box2.width / 2, box2.y + 200)
await page.waitForTimeout(200)
const strokesPage2 = await page.locator('[data-page="1"] svg path[stroke]:not([stroke="transparent"])').count()
console.log('signature stamped on page 2:', strokesPage2 > 0 ? 'PASS' : 'FAIL')

// Download and verify both stamps survive export/reopen.
const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'phase1-edited.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())

await page.goto(url)
await page.setInputFiles('input[type=file]', outPath)
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

// After reopen the ink is baked into the PDF and rendered onto the canvas
// (the SVG overlay is empty by design in a fresh session), so scan canvas
// pixels for the pen's blue (#1d4ed8) instead of counting overlay paths.
const countBluePixels = (pageIndex) =>
  page.evaluate((idx) => {
    const canvas = document.querySelector(`[data-page="${idx}"] canvas`)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      if (b > 150 && b - r > 60 && b - g > 60) count++
    }
    return count
  }, pageIndex)

const p1Blue = await countBluePixels(0)
await page.locator('[data-page="1"]').scrollIntoViewIfNeeded()
await page.waitForTimeout(800)
const p2Blue = await countBluePixels(1)
console.log('reopened file: blue ink pixels page1 =', p1Blue, 'page2 =', p2Blue)
console.log('RESULT ink persisted on both pages after export:', p1Blue > 50 && p2Blue > 50 ? 'PASS' : 'FAIL')

await browser.close()
