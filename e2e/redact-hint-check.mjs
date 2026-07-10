// Verifies the first-time "how to redact" popover: appears on first click
// of the Redact tool, dismissible via "Got it", auto-dismisses once a box
// is actually drawn, and never reappears afterwards this session.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'parcel.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(800)

console.log('hint absent before selecting redact:', (await page.getByText('How to redact').count()) === 0 ? 'PASS' : 'FAIL')

await page.getByTitle('Redact (R)').click()
await page.waitForTimeout(200)
console.log('hint appears on first redact click:', (await page.getByText('How to redact').count()) === 1 ? 'PASS' : 'FAIL')
await page.screenshot({ path: shot('50-redact-hint') })

// Switch away and back — hint should NOT reappear once already shown+not dismissed differently...
// actually per spec it should reappear if not yet dismissed. Test that first.
await page.getByTitle('Select & move (V)').click()
await page.getByTitle('Redact (R)').click()
await page.waitForTimeout(200)
console.log('hint still shows on re-select (not yet dismissed):', (await page.getByText('How to redact').count()) === 1 ? 'PASS' : 'FAIL')

// Dismiss via "Got it"
await page.getByRole('button', { name: 'Got it' }).click()
await page.waitForTimeout(200)
console.log('hint gone after "Got it":', (await page.getByText('How to redact').count()) === 0 ? 'PASS' : 'FAIL')

// Switch away and back — should stay dismissed now.
await page.getByTitle('Select & move (V)').click()
await page.getByTitle('Redact (R)').click()
await page.waitForTimeout(200)
console.log('hint stays dismissed after switching tools:', (await page.getByText('How to redact').count()) === 0 ? 'PASS' : 'FAIL')

// ----- auto-dismiss on first actual use, in a FRESH session -----
await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'parcel.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(800)
await page.getByTitle('Redact (R)').click()
await page.waitForTimeout(200)
console.log('fresh session: hint shows again:', (await page.getByText('How to redact').count()) === 1 ? 'PASS' : 'FAIL')

const box = await page.locator('[data-page="0"]').boundingBox()
const s = box.width / 612
await page.mouse.move(box.x + 219 * s, box.y + (792 - 700 - 16) * s)
await page.mouse.down()
await page.mouse.move(box.x + 260 * s, box.y + (792 - 700 + 6) * s, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(200)
console.log('hint auto-dismissed after drawing a box:', (await page.getByText('How to redact').count()) === 0 ? 'PASS' : 'FAIL')

await browser.close()
console.log('DONE')
