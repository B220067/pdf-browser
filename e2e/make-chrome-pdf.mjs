// Generates a PDF with Chrome's own print-to-PDF engine (via Playwright's
// page.pdf()) — the same producer as real-world exported docs (Google Docs
// "print", Chrome Save-as-PDF, Markdown-to-PDF tools). Chrome's text
// encoding differs meaningfully from hand-built pdf-lib fixtures: text is
// chunked into items at kerning boundaries, spaces may be positioning gaps
// rather than space characters, and fonts are subset with generated names.
// Content mirrors the user-reported document: heading + paragraph with
// bold inline prices.
import { chromium } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`
  <!doctype html>
  <html>
  <head><style>
    body { font-family: Arial, sans-serif; margin: 60px; }
    h1 { font-size: 28px; margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.5; margin: 0 0 14px; }
  </style></head>
  <body>
    <h1>Financial Blueprint for Redhill Peaks</h1>
    <p>Since you are aiming for a mid-floor unit right in the middle of the range, we will base all
    calculations on a purchase price of <b>$746,800</b>. Going 50-50 means your individual share of the
    flat is <b>$373,400</b>.</p>
    <p>Because you both started work recently (you in late January 2026, and your partner in mid-June
    2026), you do not qualify for the Enhanced CPF Housing Grant (EHG) due to the requirement
    for 12 months of continuous employment prior to application.</p>
  </body>
  </html>
`)
await page.pdf({ path: join(here, 'chrome-doc.pdf'), format: 'A4' })
await browser.close()
console.log('wrote e2e/chrome-doc.pdf (Chrome print engine)')
