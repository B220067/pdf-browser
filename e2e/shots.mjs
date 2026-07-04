// Reopens edited.pdf and captures each full page element (beyond viewport).
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'edited.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(1500)
await page.locator('[data-page="1"]').scrollIntoViewIfNeeded() // force lazy render
await page.waitForTimeout(1200)
await page.locator('[data-page="0"]').screenshot({ path: join(here, 'final-p1.png') })
await page.locator('[data-page="1"]').screenshot({ path: join(here, 'final-p2.png') })
await browser.close()
console.log('DONE')
