// Regression test for documents whose text-layer LINE BOXES vertically
// overlap (cramped line-height — chrome-tight.pdf reproduces a real user
// document where this broke everything). Three historical failure modes
// are asserted against here:
//  1. searchPadding treating the (full-width) line above/below as a
//     same-line neighbor and shrinking every span's scan window,
//  2. ink bands of adjacent lines fusing (blank-row threshold too loose),
//     corrupting the column scan,
//  3. a drag on one line catching words of the neighboring line via a
//     1px vertical graze of their (line-box-height) rects.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'chrome-tight.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1200)

const overlap = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('[data-page="0"] .textLayer span')].filter((s) => s.textContent.trim())
  const line1 = spans.find((s) => s.textContent.startsWith('Since')).getBoundingClientRect()
  const line2 = spans.find((s) => s.textContent.includes('purchase')).getBoundingClientRect()
  return line1.bottom > line2.top
})
console.log('fixture precondition — line boxes vertically overlap:', overlap ? 'PASS' : 'FAIL (fixture regenerate needed)')

await page.getByTitle('Redact (R)').click()
await page.getByText('Got it').click().catch(() => {})

const target = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('[data-page="0"] .textLayer span')]
  const price = spans.find((s) => s.textContent === '$746,800').getBoundingClientRect()
  const next = spans.find((s) => s.textContent.includes('Going 50-50')).getBoundingClientRect()
  return { price: price.toJSON(), nextLeft: next.left }
})
const y = (target.price.top + target.price.bottom) / 2
await page.mouse.move(target.price.left - 60, y - 4)
await page.mouse.down()
await page.mouse.move(target.nextLeft + 45, y + 4, { steps: 10 })
await page.waitForTimeout(250)

const state = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  const svgRect = svg.getBoundingClientRect()
  const vb = svg.getAttribute('viewBox').split(' ').map(Number)
  const sx = svgRect.width / vb[2]
  return {
    tooltip: svg.querySelector('foreignObject div')?.textContent,
    amber: [...svg.querySelectorAll('rect[fill="#f59e0b"]')].map((r) => ({
      left: svgRect.left + +r.getAttribute('x') * sx,
      right: svgRect.left + (+r.getAttribute('x') + +r.getAttribute('width')) * sx,
    })),
  }
})
console.log('tooltip:', state.tooltip)
console.log('drag on line 2 catches ONLY line-2 words (no "Since/aiming" bleed):', state.tooltip === 'Redacting: price of 746,800 Going' ? 'PASS' : 'FAIL')

const numberBox = state.amber.find((b) => b.left > target.price.left - 2 && b.right < target.price.right + 6 && b.right - b.left > 40)
console.log('"746,800" box sits inside the bold run:', numberBox ? 'PASS' : 'FAIL')
const goingBox = state.amber.find((b) => b.left > target.price.right + 4)
console.log(
  '"Going" box starts just after the price (not displaced onto 50-50):',
  goingBox && goingBox.left < target.nextLeft + 18 ? 'PASS' : 'FAIL',
)
await page.mouse.up()
await browser.close()
console.log('DONE')
