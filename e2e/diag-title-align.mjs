// Diagnostic (not a pass/fail check): compares the GROUND-TRUTH position of
// "Peaks" (computed from pdf-lib's own font metrics — the exact numbers used
// to draw the glyphs) against what pdf.js's text layer + our Range-based
// word hit-testing reports, to measure the real-world size of the drift the
// user is seeing on a large bold heading.
import { chromium } from 'playwright'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'

// ---- ground truth, in PDF points, from the exact metrics used to draw it ----
const doc = await PDFDocument.create()
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const title = 'Financial Blueprint for Redhill Peaks'
const size = 28
const idx = title.indexOf('Peaks')
const beforeWidth = bold.widthOfTextAtSize(title.slice(0, idx), size)
const wordWidth = bold.widthOfTextAtSize('Peaks', size)
const xStart = 40 + beforeWidth
const xEnd = 40 + beforeWidth + wordWidth
// PDF y=700 is the baseline, in PDF units where y grows UP from the page
// bottom. Page height 792. Ascent/descent for HelveticaBold at size 28:
const ascent = (bold.heightAtSize(size, { descender: false }) / size) * size // cap-ish height
console.log(`ground truth (pdf points, page-bottom origin): "Peaks" x=[${xStart.toFixed(1)}, ${xEnd.toFixed(1)}], baseline y=700, size=${size}`)

// ---- what the app's text layer / word hit-testing reports ----
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'title.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1000)

const pageBox = await page.locator('[data-page="0"]').boundingBox()
const s = pageBox.width / 650 // displayed CSS px per PDF point (page width 650)

// Expected CLIENT rect for "Peaks", converting ground truth page-points to
// screen px the same way the app's own toLocal()/geometry math would.
const expectedLeft = pageBox.x + xStart * s
const expectedRight = pageBox.x + xEnd * s
const expectedTop = pageBox.y + (792 - 700 - ascent) * s // top of the cap-height box
const expectedBottom = pageBox.y + (792 - 700) * s // baseline
console.log('expected client rect for "Peaks":', JSON.stringify({ left: expectedLeft, right: expectedRight, top: expectedTop, bottom: expectedBottom }))

const reported = await page.evaluate(() => {
  const container = document.querySelector('[data-page="0"] .textLayer')
  for (const span of container.querySelectorAll('span')) {
    const text = span.textContent ?? ''
    const wIdx = text.indexOf('Peaks')
    if (wIdx === -1) continue
    const spanRect = span.getBoundingClientRect()
    // Old approach: raw Range.getClientRects() on the substitute-font text.
    const node = [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)
    const range = document.createRange()
    range.setStart(node, wIdx)
    range.setEnd(node, wIdx + 'Peaks'.length)
    const oldRect = range.getBoundingClientRect()
    // New approach: character-count proportion mapped onto the span's own
    // (accurate) outer box — see lib/textLayerWords.ts.
    const totalChars = text.length
    const start = wIdx
    const end = wIdx + 'Peaks'.length
    const newLeft = spanRect.left + (start / totalChars) * spanRect.width
    const newRight = spanRect.left + (end / totalChars) * spanRect.width
    return {
      oldRect: { left: oldRect.left, right: oldRect.right, top: oldRect.top, bottom: oldRect.bottom },
      newRect: { left: newLeft, right: newRight, top: spanRect.top, bottom: spanRect.bottom },
      spanRect: { left: spanRect.left, right: spanRect.right, top: spanRect.top, bottom: spanRect.bottom },
      spanText: text,
      spanStyle: span.getAttribute('style'),
    }
  }
  return null
})
console.log('reported (old vs new):', JSON.stringify(reported, null, 2))

if (reported) {
  for (const [label, r] of [
    ['OLD (Range on substitute font)', reported.oldRect],
    ['NEW (char-count proportion)', reported.newRect],
  ]) {
    const dxLeft = r.left - expectedLeft
    const dxRight = r.right - expectedRight
    console.log(
      `${label}: drift left=${dxLeft.toFixed(1)}px (${((dxLeft / pageBox.width) * 100).toFixed(1)}%), ` +
        `right=${dxRight.toFixed(1)}px (${((dxRight / pageBox.width) * 100).toFixed(1)}%)`,
    )
  }
}

await page.screenshot({ path: join(here, '70-title-align-diag.png'), clip: { x: pageBox.x, y: pageBox.y, width: pageBox.width, height: 160 * s } })

await browser.close()
