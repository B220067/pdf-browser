// GitHub Pages has no server-side rewrites, so each client-side route gets
// its own real index.html (served with a normal 200) instead of relying
// solely on the 404.html SPA-fallback trick, which serves these paths with
// an actual 404 status — fine for users, but crawlers can treat that as a
// soft-404 and decline to index the page.
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const indexHtml = join(dist, 'index.html')

// Keep in sync with SCREEN_TO_PATH in src/App.tsx (minus the home route).
const ROUTES = ['merge', 'split', 'watermark', 'terms', 'privacy']

copyFileSync(indexHtml, join(dist, '404.html'))
for (const route of ROUTES) {
  const dir = join(dist, route)
  mkdirSync(dir, { recursive: true })
  copyFileSync(indexHtml, join(dir, 'index.html'))
}
