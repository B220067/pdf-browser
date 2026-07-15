// Regression test for word hit-testing around a BOLD inline price —
// mixed-bold.pdf reproduces the exact user-reported sentence:
//   "calculations on a purchase price of " + "$746,800" (bold) +
//   ". Going 50-50 means your individual share of the"
// Three separate text runs/spans on one line. Two bugs lived here:
//  1. The ". Going…" span begins with punctuation; measuring word
//     positions from the first WORD but mapping onto ink that includes the
//     period's pixels shifted "Going" (and every word after) left, onto
//     the bold price.
//  2. The single-word "$746,800" span short-circuited to its full ink
//     extent, wrongly swallowing the "$" (and any edge bleed).
// Ground-truth positions are computed from pdf-lib's own font metrics —
// the same numbers make-mixed-bold.mjs used to draw the fixture.
import { chromium } from 'playwright'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

// ---- ground truth (PDF points) from the fixture's own layout math ----
const doc = await PDFDocument.create()
const regular = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const SIZE = 14
const LEFT = 40
const lineY = 700 - SIZE * 1.5 // fixture line 2
const boldStart = LEFT + regular.widthOfTextAtSize('calculations on a purchase price of ', SIZE)
const boldEnd = boldStart + bold.widthOfTextAtSize('$746,800', SIZE)
const goingStart = boldEnd + regular.widthOfTextAtSize('. ', SIZE)
const goingEnd = goingStart + regular.widthOfTextAtSize('Going', SIZE)
const numberStart = boldStart + bold.widthOfTextAtSize('$', SIZE) // "746,800" begins after the $
console.log(
  `truth (pt): bold run [${boldStart.toFixed(1)}, ${boldEnd.toFixed(1)}], "746,800" starts ${numberStart.toFixed(1)}, "Going" [${goingStart.toFixed(1)}, ${goingEnd.toFixed(1)}], baseline y=${lineY}`,
)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'mixed-bold.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const pageBox = await page.locator('[data-page="0"]').boundingBox()
await page.getByTitle('Redact (R)').click()
await page.getByText('Got it').click().catch(() => {})
const s = pageBox.width / 650 // fixture page width 650pt
const toClientX = (pt) => pageBox.x + pt * s
const fromLocalX = (x) => x // committed boxes are already in page-pt units (viewBox = page size)
const lineClientY = pageBox.y + (792 - lineY - 5) * s // mid-glyph height

// ---- 1. click on "Going": box must cover Going, must NOT reach the bold price ----
await page.mouse.click(toClientX((goingStart + goingEnd) / 2), lineClientY)
await page.waitForTimeout(200)
const clickBox = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  const rects = [...svg.querySelectorAll('rect[fill="#000000"]')]
  const r = rects[rects.length - 1]
  return r ? { x: +r.getAttribute('x'), w: +r.getAttribute('width') } : null
})
console.log('box from clicking "Going":', JSON.stringify(clickBox))
const PAD = 3 // WORD_PADDING + antialias slack, in pt
console.log(
  '"Going" box does not reach into the bold price:',
  clickBox && fromLocalX(clickBox.x) > boldEnd - PAD ? 'PASS' : 'FAIL',
)
console.log(
  '"Going" box actually covers "Going":',
  clickBox && fromLocalX(clickBox.x) < goingStart + PAD && fromLocalX(clickBox.x + clickBox.w) > goingEnd - PAD
    ? 'PASS'
    : 'FAIL',
)

// ---- 2. fresh load; click on the price: box covers "746,800", not "Going" ----
await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'mixed-bold.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)
await page.getByTitle('Redact (R)').click()
await page.getByText('Got it').click().catch(() => {})
await page.mouse.click(toClientX((numberStart + boldEnd) / 2), lineClientY)
await page.waitForTimeout(200)
const priceBox = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  const rects = [...svg.querySelectorAll('rect[fill="#000000"]')]
  const r = rects[rects.length - 1]
  return r ? { x: +r.getAttribute('x'), w: +r.getAttribute('width') } : null
})
console.log('box from clicking the price:', JSON.stringify(priceBox))
console.log(
  'price box covers "746,800":',
  priceBox && fromLocalX(priceBox.x) < numberStart + PAD && fromLocalX(priceBox.x + priceBox.w) > boldEnd - PAD
    ? 'PASS'
    : 'FAIL',
)
console.log(
  'price box does not reach into "Going":',
  priceBox && fromLocalX(priceBox.x + priceBox.w) < goingStart + PAD ? 'PASS' : 'FAIL',
)

// ---- 3. drag across just "Going": tooltip must list only Going ----
await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'mixed-bold.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)
await page.getByTitle('Redact (R)').click()
await page.getByText('Got it').click().catch(() => {})
await page.mouse.move(toClientX(goingStart + 2), pageBox.y + (792 - lineY - 11) * s)
await page.mouse.down()
await page.mouse.move(toClientX(goingEnd - 2), pageBox.y + (792 - lineY + 3) * s, { steps: 8 })
await page.waitForTimeout(200)
const tooltip = await page.evaluate(
  () => document.querySelector('[data-page="0"] svg[data-layer="redact"] foreignObject div')?.textContent ?? null,
)
console.log('mid-drag tooltip over "Going":', JSON.stringify(tooltip))
console.log('tooltip says exactly "Going" (price not caught):', tooltip === 'Redacting: Going' ? 'PASS' : 'FAIL')
await page.screenshot({ path: shot('86-mixed-bold-drag'), clip: { x: pageBox.x, y: pageBox.y + 50 * s, width: pageBox.width, height: 80 * s } })
await page.mouse.up()

await browser.close()
console.log('DONE')
