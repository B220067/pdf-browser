// Same Chrome-print fixture but with cramped line-height, so consecutive
// lines' text-layer boxes vertically OVERLAP — common in real documents.
import { chromium } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`
  <!doctype html><html><head><style>
    body { font-family: Arial, sans-serif; margin: 60px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p { font-size: 15px; line-height: 1.15; margin: 0 0 10px; }
  </style></head><body>
    <h1>Financial Blueprint for Redhill Peaks</h1>
    <p>Since you are aiming for a mid-floor unit right in the middle of the range, we will base all
    calculations on a purchase price of <b>$746,800</b>. Going 50-50 means your individual share of the
    flat is <b>$373,400</b>.</p>
  </body></html>
`)
await page.pdf({ path: join(here, 'chrome-tight.pdf'), format: 'A4' })
await browser.close()
console.log('wrote e2e/chrome-tight.pdf')
