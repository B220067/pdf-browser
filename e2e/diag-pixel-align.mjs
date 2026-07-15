// Ground truth via actual canvas pixels (not hand-computed PDF metrics,
// which the previous diagnostic showed can itself be slightly off) — scans
// the rendered page canvas for ink columns to find where "Peaks" genuinely
// starts and ends, then compares that against our word-hit rect.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'title.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const result = await page.evaluate(() => {
  const pageEl = document.querySelector('[data-page="0"]')
  const canvas = pageEl.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height).data

  // Title band: roughly the top ~15% of the canvas (title is drawn near the
  // top of the page). Find rows with dark ink to locate the title's vertical
  // extent, then within those rows find the ink column range.
  const isDark = (x, y) => {
    const i = (y * width + x) * 4
    return img[i] < 120 && img[i + 1] < 120 && img[i + 2] < 120 && img[i + 3] > 128
  }
  let rowStart = -1
  let rowEnd = -1
  for (let y = 0; y < height * 0.3; y++) {
    let hasInk = false
    for (let x = 0; x < width; x += 2) {
      if (isDark(x, y)) { hasInk = true; break }
    }
    if (hasInk) {
      if (rowStart === -1) rowStart = y
      rowEnd = y
    } else if (rowStart !== -1 && y - rowEnd > 5) {
      break // first ink band ends (title line only)
    }
  }

  // Within the title's row band, find ink columns from the RIGHT edge
  // inward, to locate "Peaks" (the last word) — stop at the first gap wider
  // than ~8px, which marks the space before "Peaks".
  let colEnd = -1
  for (let x = width - 1; x >= 0; x--) {
    let hasInk = false
    for (let y = rowStart; y <= rowEnd; y++) {
      if (isDark(x, y)) { hasInk = true; break }
    }
    if (hasInk) { colEnd = x; break }
  }
  let gapRun = 0
  let colStart = -1
  for (let x = colEnd; x >= 0; x--) {
    let hasInk = false
    for (let y = rowStart; y <= rowEnd; y++) {
      if (isDark(x, y)) { hasInk = true; break }
    }
    if (hasInk) {
      gapRun = 0
    } else {
      gapRun++
      if (gapRun > 10) { colStart = x + gapRun; break }
    }
  }

  const rect = canvas.getBoundingClientRect()
  const sx = rect.width / width
  const sy = rect.height / height
  return {
    canvasPeaksPixelRange: { colStart, colEnd, rowStart, rowEnd },
    clientRect: {
      left: rect.left + colStart * sx,
      right: rect.left + colEnd * sx,
      top: rect.top + rowStart * sy,
      bottom: rect.top + rowEnd * sy,
    },
  }
})
console.log('pixel-scanned ground truth for "Peaks":', JSON.stringify(result, null, 2))

// Now get our word-hit rect for "Peaks" via the actual app module logic
// (char-count proportion on the span's own rect).
const detected = await page.evaluate(() => {
  const container = document.querySelector('[data-page="0"] .textLayer')
  for (const span of container.querySelectorAll('span')) {
    const text = span.textContent ?? ''
    const idx = text.indexOf('Peaks')
    if (idx === -1) continue
    const spanRect = span.getBoundingClientRect()
    const totalChars = text.length
    const left = spanRect.left + (idx / totalChars) * spanRect.width
    const right = spanRect.left + ((idx + 5) / totalChars) * spanRect.width
    return { left, right, top: spanRect.top, bottom: spanRect.bottom }
  }
  return null
})
console.log('detected word rect (char-count proportion):', JSON.stringify(detected, null, 2))

const dxLeft = detected.left - result.clientRect.left
const dxRight = detected.right - result.clientRect.right
console.log(`drift vs actual pixels: left=${dxLeft.toFixed(1)}px, right=${dxRight.toFixed(1)}px`)

await page.screenshot({ path: join(here, '72-pixel-diag.png'), clip: { x: result.clientRect.left - 250, y: result.clientRect.top - 20, width: 300, height: 70 } })

await browser.close()
