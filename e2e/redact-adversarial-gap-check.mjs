// The most faithful reproduction available of the real-world bug without
// the user's actual file: open title.pdf in the REAL app (real pdf.js font
// loading, real canvas rendering, real redact tool), then paint a white
// slice directly onto the REAL rendered "Blueprint" ink — physically
// splitting it into two ink fragments with a gap wider than the line's
// real inter-word gaps, the exact adversarial shape reported (a word's
// internal gap wider than real word-boundary gaps). Verifies the full
// pipeline — real font-name extraction, real canvas ink scan, DP boundary
// assignment — handles this correctly end to end, not just the isolated
// algorithm.
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
await page.setInputFiles('input[type=file]', join(here, 'title.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

// Find "Blueprint"'s real rendered ink extent on the canvas, then paint a
// white gap through its middle — wider than the real ~20-25px word gaps on
// this line — splitting its ink into two disconnected fragments.
const injected = await page.evaluate(() => {
  const container = document.querySelector('[data-page="0"] .textLayer')
  const canvas = document.querySelector('[data-page="0"] canvas')
  const ctx = canvas.getContext('2d')
  const span = [...container.querySelectorAll('span')].find((s) => s.textContent.includes('Financial'))
  const text = span.textContent
  const idx = text.indexOf('Blueprint')
  const spanRect = span.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  const sx = canvas.width / canvasRect.width
  const sy = canvas.height / canvasRect.height

  // Char-count estimate of "Blueprint"'s rough span (good enough just to
  // locate roughly where to paint — the real ink-scan will find the exact
  // extent on its own).
  const totalChars = text.length
  const left = spanRect.left + (idx / totalChars) * spanRect.width
  const right = spanRect.left + ((idx + 'Blueprint'.length) / totalChars) * spanRect.width
  const mid = (left + right) / 2

  const canvasMidX = (mid - canvasRect.left) * sx
  const canvasTop = (spanRect.top - canvasRect.top) * sy
  const canvasBottom = (spanRect.bottom - canvasRect.top) * sy
  const gapWidthCanvasPx = 60 * sx // wider than this line's real word gaps

  ctx.fillStyle = 'white'
  ctx.fillRect(canvasMidX - gapWidthCanvasPx / 2, canvasTop - 5 * sy, gapWidthCanvasPx, canvasBottom - canvasTop + 10 * sy)

  return { gapCenterClientX: mid, gapWidthClientPx: 60 }
})
console.log('injected artificial gap into real "Blueprint" ink at client x=', injected.gapCenterClientX)

await page.screenshot({ path: shot('82-adversarial-gap-injected'), clip: { x: 0, y: 0, width: 1200, height: 200 } })

const pageBox = await page.locator('[data-page="0"]').boundingBox()
await page.getByTitle('Redact (R)').click()
await page.getByText('Got it').click().catch(() => {})
const s = pageBox.width / 650
await page.mouse.move(pageBox.x + 30 * s, pageBox.y + (792 - 700 - 30) * s)
await page.mouse.down()
await page.mouse.move(pageBox.x + 560 * s, pageBox.y + (792 - 700 + 10) * s, { steps: 15 })
await page.waitForTimeout(200)

const tooltip = await page.evaluate(() => document.querySelector('[data-page="0"] svg[data-layer="redact"] foreignObject div')?.textContent)
console.log('tooltip:', tooltip)
console.log('tooltip lists all 5 real words, "Blueprint" intact (not split):', tooltip === 'Redacting: Financial Blueprint for Redhill Peaks' ? 'PASS' : 'FAIL')

const amberRects = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  return [...svg.querySelectorAll('rect[fill="#f59e0b"]')].map((r) => +r.getAttribute('width'))
})
console.log('amber box count (should be exactly 5, one per real word):', amberRects.length, amberRects.length === 5 ? 'PASS' : 'FAIL')

await page.screenshot({ path: shot('83-adversarial-gap-preview'), clip: { x: pageBox.x, y: pageBox.y, width: pageBox.width, height: 130 * s } })
await page.mouse.up()

await browser.close()
console.log('DONE')
