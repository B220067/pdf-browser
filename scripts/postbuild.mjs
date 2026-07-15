// GitHub Pages has no server-side rewrites, so each client-side route gets
// its own real index.html (served with a normal 200) instead of relying
// solely on the 404.html SPA-fallback trick, which serves these paths with
// an actual 404 status — fine for users, but crawlers can treat that as a
// soft-404 and decline to index the page.
//
// Beyond that: React only fixes up <title>/description/canonical after
// hydration, which requires executing JS. Most AI crawlers (GPTBot,
// ClaudeBot, PerplexityBot, etc.) fetch raw HTML and never run it, so
// without this step every non-home route would serve them the homepage's
// title, description, canonical (pointing back at "/"), and structured
// data — effectively invisible/duplicate as far as an LLM or search index
// is concerned. This bakes the correct per-route metadata and a
// route-specific SoftwareApplication JSON-LD block directly into each
// route's static HTML, so it's readable without executing anything.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const indexHtmlPath = join(dist, 'index.html')
const SITE_URL = 'https://inkspdf.com'

// Keep in sync with src/seo-routes.json and SCREEN_TO_PATH in src/App.tsx.
const seoRoutes = JSON.parse(readFileSync(join(root, 'src', 'seo-routes.json'), 'utf8'))
const ROUTES = ['merge', 'split', 'watermark', 'terms', 'privacy']

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const escapeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c')

function softwareApplicationSchema(route) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: route.schemaName,
    description: route.schemaDescription,
    url: `${SITE_URL}${route.path}`,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript.',
    featureList: route.featureList,
    image: `${SITE_URL}/InksPDF.png`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
}

function renderRouteHtml(baseHtml, route) {
  const title = escapeHtml(route.title)
  const description = escapeHtml(route.description)
  const url = `${SITE_URL}${route.path}`

  let html = baseHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/s,
      `<meta name="description" content="${description}" />`,
    )
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/s,
      `<meta property="og:description" content="${description}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${title}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/s,
      `<meta name="twitter:description" content="${description}" />`,
    )

  // Tool routes get their own SoftwareApplication JSON-LD, inserted right
  // after the site-wide WebApplication block — matching the DOM state once
  // React hydrates and the tool component mounts its own schema script.
  if (route.schemaName) {
    const schema = escapeJson(softwareApplicationSchema(route))
    html = html.replace(
      /(<script type="application\/ld\+json">[\s\S]*?<\/script>)/,
      `$1\n    <script type="application/ld+json">${schema}</script>`,
    )
  }

  return html
}

const baseHtml = readFileSync(indexHtmlPath, 'utf8')

copyFileSync(indexHtmlPath, join(dist, '404.html'))

for (const routeKey of ROUTES) {
  const route = seoRoutes[routeKey]
  const dir = join(dist, routeKey)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), renderRouteHtml(baseHtml, route))
}
