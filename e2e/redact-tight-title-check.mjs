// Verifies word-level redaction hit-testing on title-tight.pdf — a heading
// with a paragraph tightly below (see make-title-tight.mjs for why that
// spacing matters). Asserts the PIXEL path ran, not the char-count
// fallback: fallback boxes are full line-box height and char-proportional,
// so the checks below (tight height, glyph-accurate edges) fail on it.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'title-tight.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const pageBox = await page.locator('[data-page="0"]').boundingBox()
await page.getByTitle('Redact (R)').click()
await page.getByText('Got it').click().catch(() => {})
const s = pageBox.width / 650

// Drag across the whole heading (staying above the tight paragraph below).
await page.mouse.move(pageBox.x + 30 * s, pageBox.y + (792 - 700 - 30) * s)
await page.mouse.down()
await page.mouse.move(pageBox.x + 560 * s, pageBox.y + (792 - 700 + 8) * s, { steps: 15 })
await page.waitForTimeout(200)

const preview = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  const tooltip = svg?.querySelector('foreignObject div')?.textContent ?? null
  const rects = [...(svg?.querySelectorAll('rect[fill="#f59e0b"]') ?? [])].map((r) => ({
    x: +r.getAttribute('x'),
    y: +r.getAttribute('y'),
    w: +r.getAttribute('width'),
    h: +r.getAttribute('height'),
  }))
  const span = [...document.querySelectorAll('[data-page="0"] .textLayer span')].find((sp) =>
    sp.textContent.includes('Financial'),
  )
  const spanRect = span.getBoundingClientRect()
  const svgRect = svg.getBoundingClientRect()
  const vb = svg.getAttribute('viewBox').split(' ').map(Number)
  const spanHeightLocal = (spanRect.height / svgRect.height) * vb[3]
  return { tooltip, rects, spanHeightLocal }
})

console.log('tooltip:', preview.tooltip)
console.log('amber rects:', JSON.stringify(preview.rects.map((r) => ({ x: +r.x.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) }))))
console.log('span line-box height (local units):', preview.spanHeightLocal.toFixed(1))

console.log(
  'tooltip lists exactly the 5 heading words:',
  preview.tooltip === 'Redacting: Financial Blueprint for Redhill Peaks' ? 'PASS' : 'FAIL',
)
console.log('exactly 5 word boxes:', preview.rects.length === 5 ? 'PASS' : 'FAIL')

// Pixel path produces glyph-tight boxes; the char-count fallback's boxes
// are the full line-box height. Require meaningfully tighter than that.
const allTight = preview.rects.every((r) => r.h < preview.spanHeightLocal * 0.95)
console.log('boxes are glyph-tight (pixel path ran, not the fallback):', allTight ? 'PASS' : 'FAIL')

// Heading words shouldn't overlap each other and should ascend in x.
const sorted = [...preview.rects].sort((a, b) => a.x - b.x)
let ordered = true
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].x < sorted[i - 1].x + sorted[i - 1].w - 1) ordered = false
}
console.log('word boxes are disjoint and ordered:', ordered ? 'PASS' : 'FAIL')

await page.screenshot({ path: shot('84-tight-title-preview'), clip: { x: pageBox.x, y: pageBox.y, width: pageBox.width, height: 140 * s } })
await page.mouse.up()

await browser.close()
console.log('DONE')
