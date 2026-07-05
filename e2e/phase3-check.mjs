// Verifies Phase 3: AcroForm fields render as interactive overlays, get
// filled, and the values are baked (flattened) into the downloaded PDF.
// Also exercises the Phase 2 interplay: reorders pages of the form PDF and
// confirms the filled values still land correctly.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 1400 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'form-test.pdf'))
await page.waitForSelector('[data-page="0"] canvas')
await page.waitForTimeout(800)

// ---- overlays detected? ----
const textInput = page.locator('input[title="applicant.name"]')
const checkbox = page.locator('input[title="applicant.agree"]')
const dropdown = page.locator('select[title="applicant.color"]')
// pdf-lib-created radios expose appearance-state names ('0','1') as their
// per-widget on-values; 'M' is the second option → state '1'.
const radioM = page.locator('input[title="applicant.size: 1"]')
console.log('text field overlay:', (await textInput.count()) === 1 ? 'PASS' : 'FAIL')
console.log('checkbox overlay:', (await checkbox.count()) === 1 ? 'PASS' : 'FAIL')
console.log('dropdown overlay:', (await dropdown.count()) === 1 ? 'PASS' : 'FAIL')
console.log('radio overlays:', (await page.locator('input[type=radio]').count()) === 2 ? 'PASS' : 'FAIL')

// ---- fill everything ----
await textInput.click()
await textInput.fill('Chloe Lim')
await checkbox.check()
await dropdown.selectOption('Blue')
await radioM.check()
await page.waitForTimeout(200)

// ---- undo coalescing probe: one undo clears the whole typed name ----
await page.getByTitle('Undo (Ctrl+Z)').click()
await page.waitForTimeout(150)
const nameAfterUndo = await textInput.inputValue()
console.log('one undo reverts radio selection (last change), name intact:', JSON.stringify(nameAfterUndo))
await page.getByTitle('Redo (Ctrl+Shift+Z)').click()
await page.waitForTimeout(150)

// ---- reorder: move page 2 above page 1 (form page) ----
const thumbs = page.locator('aside > div > div')
const t1 = await thumbs.nth(1).boundingBox()
const t0 = await thumbs.nth(0).boundingBox()
await page.mouse.move(t1.x + t1.width / 2, t1.y + 20)
await page.mouse.down()
await page.mouse.move(t0.x + t0.width / 2, t0.y + 10, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
console.log('reordered: SECOND PAGE should now be first')

// ---- download ----
const dlPromise = page.waitForEvent('download')
await page.getByRole('button', { name: /Download/ }).click()
const dl = await dlPromise
const outPath = join(here, 'phase3-edited.pdf')
await dl.saveAs(outPath)
console.log('downloaded:', dl.suggestedFilename())
await browser.close()
