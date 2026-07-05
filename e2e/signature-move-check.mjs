// Verifies signature group-move: a TWO-stroke signature stamped on the page
// must select and move as one piece when any single part is dragged, while
// a separate hand-drawn stroke moves independently. Also checks the
// "Redraw" label is visible.
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

// ---- capture a TWO-stroke signature ----
await page.getByTitle(/Draw a signature to reuse/).click()
await page.waitForSelector('[role=dialog]')
const sig = await page.locator('[role=dialog] svg.cursor-crosshair').boundingBox()
// stroke 1: wave on the left half
await page.mouse.move(sig.x + 20, sig.y + sig.height / 2)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(sig.x + 20 + (i * (sig.width / 2 - 30)) / 8, sig.y + sig.height / 2 + Math.sin(i) * 12, { steps: 1 })
}
await page.mouse.up()
// stroke 2: a separate dash on the right half
await page.mouse.move(sig.x + sig.width / 2 + 20, sig.y + sig.height / 2)
await page.mouse.down()
await page.mouse.move(sig.x + sig.width - 20, sig.y + sig.height / 2 - 10, { steps: 4 })
await page.mouse.up()
await page.getByRole('button', { name: 'Save signature' }).click()
await page.waitForTimeout(200)

// ---- Redraw label visible? ----
const redrawVisible = await page.getByRole('button', { name: 'Redraw' }).isVisible()
console.log('Redraw button labelled and visible:', redrawVisible ? 'PASS' : 'FAIL')

// ---- stamp once, then a separate hand-drawn stroke ----
await page.mouse.click(box.x + box.width / 2, box.y + 300)
await page.waitForTimeout(200)
await page.getByTitle('Draw / sign (D)').click()
await page.mouse.move(box.x + 100, box.y + 700)
await page.mouse.down()
await page.mouse.move(box.x + 200, box.y + 720, { steps: 4 })
await page.mouse.up()
await page.waitForTimeout(200)

const paths = page.locator('[data-page="0"] svg path[stroke]:not([stroke="transparent"])')
console.log('stroke count (2 signature + 1 hand-drawn):', await paths.count())

const dBefore = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))

// ---- select tool: drag ONLY the first signature stroke's area ----
await page.getByTitle('Select & move (V)').click()
// First signature stroke sits left of the stamp center.
const grabX = box.x + box.width / 2 - 60
const grabY = box.y + 300
await page.mouse.move(grabX, grabY)
await page.mouse.down()
await page.mouse.move(grabX + 120, grabY + 90, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)

const dAfter = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))
const moved = dBefore.map((d, i) => d !== dAfter[i])
console.log('which strokes moved [sig1, sig2, hand]:', moved)
console.log('RESULT both signature strokes moved together:', moved[0] && moved[1] ? 'PASS' : 'FAIL')
console.log('RESULT hand-drawn stroke did NOT move:', !moved[2] ? 'PASS' : 'FAIL')

// ---- selection frame visible ----
const frame = await page.locator('[data-page="0"] svg rect[stroke-dasharray]').count()
console.log('selection frame around signature:', frame === 1 ? 'PASS' : 'FAIL')

// ---- undo: whole drag reverts in one step ----
await page.getByTitle('Undo (Ctrl+Z)').click()
await page.waitForTimeout(200)
const dUndone = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))
const restored = dUndone.every((d, i) => d === dBefore[i])
console.log('RESULT one undo restores pre-drag position:', restored ? 'PASS' : 'FAIL')

// ---- hand-drawn stroke moves individually ----
await page.getByTitle('Redo (Ctrl+Shift+Z)').click()
await page.waitForTimeout(200)
const handBefore = (await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d'))))
await page.mouse.move(box.x + 150, box.y + 710)
await page.mouse.down()
await page.mouse.move(box.x + 250, box.y + 760, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(300)
const handAfter = await paths.evaluateAll((els) => els.map((el) => el.getAttribute('d')))
const movedHand = handBefore.map((d, i) => d !== handAfter[i])
console.log('which strokes moved [sig1, sig2, hand]:', movedHand)
console.log('RESULT only hand-drawn stroke moved:', !movedHand[0] && !movedHand[1] && movedHand[2] ? 'PASS' : 'FAIL')

await browser.close()
