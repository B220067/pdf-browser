// Regression test for word-level hit-testing (src/lib/textLayerWords.ts).
// parcel.pdf's "Please collect the" is drawn as ONE Tj call for all three
// words (see make-parcel.mjs) — the same shape as a real-world PDF title,
// which is very often one text-showing operation for the whole line. Before
// the fix, any click/drag touching this run highlighted/selected the ENTIRE
// run as one indivisible span; this checks that only the targeted word is
// affected now, both in the live preview and in the committed box's shape.
import { chromium } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

// Exact rendered client rect for a substring, via the same Range technique
// lib/textLayerWords.ts uses — proportional Helvetica glyph widths can't be
// guessed reliably by hand (an earlier version of this test tried and landed
// on the wrong word), so ask the real DOM instead.
async function clientRectFor(text) {
  return page.evaluate((t) => {
    const container = document.querySelector('[data-page="0"] .textLayer')
    for (const span of container.querySelectorAll('span')) {
      const full = span.textContent ?? ''
      const idx = full.indexOf(t)
      if (idx === -1) continue
      const node = [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)
      if (!node) continue
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + t.length)
      const r = range.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    return null
  }, text)
}

const readCommittedBoxWidth = () =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
    const rects = [...(svg?.querySelectorAll('rect[fill="#000000"]') ?? [])]
    const r = rects[rects.length - 1]
    return r ? +r.getAttribute('width') : null
  })

async function openFixture() {
  await page.goto(url)
  await page.setInputFiles('input[type=file]', join(here, 'parcel.pdf'))
  await page.waitForSelector('[data-page="0"] canvas')
  await page.waitForTimeout(1000)
  await page.getByTitle('Redact (R)').click()
}

await openFixture()
const box = await page.locator('[data-page="0"]').boundingBox()
const fullRunRect = await clientRectFor('Please collect the')
const collectRect = await clientRectFor('collect')
console.log('full run "Please collect the" rect:', JSON.stringify(fullRunRect))
console.log('"collect" alone rect:', JSON.stringify(collectRect))
console.log('"collect" is meaningfully narrower than the full 3-word run:', collectRect.width < fullRunRect.width * 0.6 ? 'PASS' : 'FAIL')

// ---- 1. Plain CLICK on "collect" (middle word of the 3-word single-Tj run) ----
await page.mouse.click((collectRect.left + collectRect.right) / 2, (collectRect.top + collectRect.bottom) / 2)
await page.waitForTimeout(150)

const clickWidth = await readCommittedBoxWidth()
console.log('box width committed by a click on "collect" (local units):', clickWidth)
const runWidthLocalRatio = clickWidth !== null ? clickWidth / collectRect.width : null
console.log('local-unit-per-client-px scale implied by this click:', runWidthLocalRatio)
console.log(
  'click box is NOT the generic 140pt default box:',
  clickWidth !== null && clickWidth !== 140 ? 'PASS' : 'FAIL',
)

// ---- 2. DRAG across just "collect" (small inset so the drag stays strictly
// inside its own rect, not touching "Please" or "the") ----
await openFixture()
const inset = collectRect.width * 0.15
const dragX1 = collectRect.left + inset
const dragX2 = collectRect.right - inset
// A real drag always has some height too, not just width — a perfectly
// horizontal drag has ~0 height, which is below MIN_BOX_SIZE and gets
// silently dropped before it ever reaches the word-snap logic.
const dragY1 = collectRect.top
const dragY2 = collectRect.bottom
await page.mouse.move(dragX1, dragY1)
await page.mouse.down()
await page.mouse.move(dragX2, dragY2, { steps: 10 })
await page.waitForTimeout(150)

const preview = await page.evaluate(() => {
  const svg = document.querySelector('[data-page="0"] svg[data-layer="redact"]')
  const tooltip = svg?.querySelector('foreignObject div')?.textContent ?? null
  const amberRects = [...(svg?.querySelectorAll('rect[fill="#f59e0b"]') ?? [])].map((r) => +r.getAttribute('width'))
  return { tooltip, amberRects }
})
console.log('mid-drag preview over "collect":', JSON.stringify(preview))
console.log('tooltip says exactly "collect", not the whole run:', preview.tooltip === 'Redacting: collect' ? 'PASS' : 'FAIL')
console.log('exactly one amber word-rect shown (not one big span rect):', preview.amberRects.length === 1 ? 'PASS' : 'FAIL')

await page.screenshot({ path: shot('60-word-snap-preview'), clip: { x: box.x, y: box.y + 60 * (box.width / 612), width: box.width, height: 100 * (box.width / 612) } })

await page.mouse.up()
await page.waitForTimeout(150)

const dragWidth = await readCommittedBoxWidth()
console.log('committed drag box width (local units):', dragWidth)
console.log(
  'drag box snapped to word width, not the whole run:',
  dragWidth !== null && clickWidth !== null && dragWidth < clickWidth * 1.5 ? 'PASS' : 'FAIL',
)

await page.screenshot({ path: shot('61-word-snap-committed'), clip: { x: box.x, y: box.y + 60 * (box.width / 612), width: box.width, height: 100 * (box.width / 612) } })

// ---- 3. Export and confirm the saved file: "collect" gone from extractable
// text, "This second line..." (a fully separate, untouched run) stays real
// text. "Please"/"the" share collect's original Tj operation, so — same
// documented tradeoff as redact-partial-word-check.mjs — they also stop
// being extractable text even though the screenshot above shows them still
// visually intact (preserved as raster pixels, not vector text). ----
const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'word-snap-edited.pdf')
await dl.saveAs(outPath)

const data = new Uint8Array(readFileSync(outPath))
const doc = await getDocument({ data }).promise
const content = await (await doc.getPage(1)).getTextContent()
const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
console.log('extracted text from saved file:', JSON.stringify(text))
console.log('"collect" not recoverable from text layer:', !text.includes('collect') ? 'PASS' : 'FAIL')
console.log('untouched second line survives as real text:', text.includes('This second line should stay fully selectable.') ? 'PASS' : 'FAIL')

await browser.close()
console.log('DONE')
