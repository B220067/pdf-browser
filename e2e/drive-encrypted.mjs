// Verifies the encryption guard: uploading a permission-restricted PDF must
// be rejected up front (before the editor even opens), because pdf-lib has
// no real encryption support and can't safely re-save such a file.
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.APP_URL ?? 'http://localhost:4173/'
const shot = (name) => join(here, `${name}.png`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(url)
await page.setInputFiles('input[type=file]', join(here, 'encrypted-owner.pdf'))
await page.waitForTimeout(1200)
await page.screenshot({ path: shot('20-encrypted-blocked') })

const editorOpened = await page.locator('[data-page="0"] canvas').isVisible().catch(() => false)
console.log('Editor opened for encrypted file:', editorOpened ? 'FAIL (should be blocked)' : 'PASS (blocked)')

const errorText = await page.locator('text=encrypted').first().textContent().catch(() => null)
console.log('Error message shown:', errorText ?? 'NONE FOUND')

const chooseAnother = await page.getByRole('button', { name: /Choose another file/ }).isVisible().catch(() => false)
console.log('"Choose another file" recovery path shown:', chooseAnother ? 'PASS' : 'FAIL')

await browser.close()
