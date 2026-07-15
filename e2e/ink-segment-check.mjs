// Directly tests lib/canvasInk.ts's segmentIntoWords against a CONTRIVED
// ink pattern reproducing a bug found in production: a heading where
// "Blueprint" rendered with an internal gap WIDER than the line's real
// word gaps. Gap-counting algorithms split it in two (and corrupted the
// rest of the line); the current measured-width layout must keep it whole
// while still finding every real word edge. Runs against the real compiled
// module via Vite's dev server (not a reimplementation) so this exercises
// the actual app code.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const dev = spawn('npx', ['vite', '--port', '5183', '--strictPort'], { cwd: root, stdio: 'pipe' })
await new Promise((resolve, reject) => {
  let out = ''
  dev.stdout.on('data', (d) => {
    out += d.toString()
    if (out.includes('ready in')) resolve()
  })
  dev.stderr.on('data', (d) => console.error('[vite]', d.toString()))
  dev.on('exit', (code) => reject(new Error(`vite exited early with code ${code}`)))
  setTimeout(() => reject(new Error('vite did not start in time')), 15000)
})

try {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('http://localhost:5183/')

  const result = await page.evaluate(async () => {
    const mod = await import('/src/lib/canvasInk.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 60
    const ctx = canvas.getContext('2d')

    // Draw the words as REAL rendered text (default font), so the ink
    // pattern has authentic per-letter gaps — then paint a white slice
    // through the middle of "Blueprint", making its internal gap wider
    // than any real word gap on the line.
    const fullText = 'Financial Blueprint for Redhill Peaks'
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 1600, 60)
    ctx.fillStyle = 'black'
    ctx.font = '40px sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText(fullText, 20, 10)

    // Ground truth per-word extents from the same font/position used to draw.
    const wordRanges = []
    const re = /\S+/g
    let m
    while ((m = re.exec(fullText))) wordRanges.push({ text: m[0], start: m.index, end: m.index + m[0].length })
    const truth = wordRanges.map(({ start, end }) => ({
      left: 20 + ctx.measureText(fullText.slice(0, start)).width,
      right: 20 + ctx.measureText(fullText.slice(0, end)).width,
    }))

    // Adversarial slice: white gap through the middle of "Blueprint",
    // wider than the real inter-word spaces (~11px at this size).
    const bpMid = (truth[1].left + truth[1].right) / 2
    ctx.fillStyle = 'white'
    ctx.fillRect(bpMid - 12, 0, 24, 60)

    const bands = mod.findInkRowBands(ctx, 0, 1600, 0, 60)
    const runs = mod.segmentIntoWords(
      ctx,
      0,
      1600,
      bands[0].start,
      bands[0].end,
      fullText,
      wordRanges,
      null, // generic font — same family used to draw, so measured = truth
    )
    return { truth, runs, bandCount: bands.length }
  })

  console.log('ground-truth word extents:', JSON.stringify(result.truth.map((t) => ({ l: +t.left.toFixed(0), r: +t.right.toFixed(0) }))))
  console.log('segmented runs:', JSON.stringify(result.runs?.map((r) => ({ l: +r.start.toFixed(0), r: +r.end.toFixed(0) }))))
  console.log('found exactly one ink band:', result.bandCount === 1 ? 'PASS' : `FAIL (${result.bandCount})`)

  if (!result.runs || result.runs.length !== 5) {
    console.log('produced exactly 5 segments: FAIL', result.runs?.length)
  } else {
    console.log('produced exactly 5 segments: PASS')
    const names = ['Financial', 'Blueprint', 'for', 'Redhill', 'Peaks']
    // Each segment's center must sit within its true word's extent, and the
    // segment must cover most of the word — loose enough for antialiasing,
    // tight enough to catch any word-level misassignment.
    result.runs.forEach((run, i) => {
      const t = result.truth[i]
      const center = (run.start + run.end) / 2
      const centerOk = center > t.left && center < t.right
      const coverOk = Math.min(run.end, t.right) - Math.max(run.start, t.left) > 0.7 * (t.right - t.left)
      console.log(`"${names[i]}" segment centered & covering its true extent:`, centerOk && coverOk ? 'PASS' : 'FAIL')
    })
  }

  await browser.close()
} finally {
  dev.kill()
}
