// Track-select thumbnails: per campaign and style track (every non-test track) one top-down frame (`?cam=top&freeze=1`), public/thumbs/<track>.webp,
// and one chase-camera frame 30% round the lap, public/thumbs/<track>-drive.webp. The start menu shows them as tiles and
// in the preview panel (src/menu/start.ts); a track without one falls back
// to its SVG outline (src/menu/thumbnail.ts). Re-run after adding or reshaping a track: `make thumbs` (commit the files;
// CI has no browser). Starts its own Vite dev server; the browser is muted and every DOM overlay is hidden before the shot.
// On macOS headless Chromium needs the GPU flags below, or the screenshot times out.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

// Every shipped track the menu shows without ?dev=1: all of assets/track/ but the test-* tracks and the piece catalogue.
const tracks = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('assets/track')
      .filter((f) => f.endsWith('.json') && !f.startsWith('test') && f !== 'pieces.json') // pieces.json: the kit catalogue (src/track/registry.ts)
      .map((f) => f.slice(0, -'.json'.length))
const out = 'public/thumbs'
const WIDTH = 480
const HEIGHT = 300

mkdirSync(out, { recursive: true })
const server = await createServer({ server: { port: 0 }, logLevel: 'warn' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
const encoder = await browser.newPage()
try {
  const shoot = async (url, file) => {
    await page.goto(url)
    await page.waitForFunction(() => window.driftline?.ready, null, { timeout: 90_000 })
    await page.waitForTimeout(1500) // shadows, environment and the chase camera settle
    await page.evaluate(() => {
      for (const el of document.body.querySelectorAll('*')) if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden'
    })
    const png = await page.screenshot()
    const webp = await encoder.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
      c.getContext('2d').drawImage(img, 0, 0)
      return c.toDataURL('image/webp', 0.82).split(',')[1]
    }, png.toString('base64'))
    writeFileSync(file, Buffer.from(webp, 'base64'))
    console.log(file)
  }
  for (const track of tracks) {
    await shoot(`${base}?track=${track}&cam=top&freeze=1&vol=0&debug=0`, `${out}/${track}.webp`)
    const line = await page.evaluate(() => window.driftline.centreline(10))
    const p = line[Math.floor(line.length * 0.3)]
    const yaw = (p.heading * 180) / Math.PI
    await shoot(`${base}?track=${track}&x=${p.x}&y=${p.y}&z=${p.z}&yaw=${yaw}&freeze=1&vol=0&debug=0`, `${out}/${track}-drive.webp`)
  }
} finally {
  await browser.close()
  await server.close()
}
