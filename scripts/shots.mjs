// Debug screenshots: walk each lap's centreline every STEP metres and save one PNG per pose.
// Usage: npm run shots [-- lap1 lap2 crossover tower] (env STEP=20, OUT=shots). Starts its own Vite dev server.
import { mkdirSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const laps = process.argv.slice(2).length ? process.argv.slice(2) : ['lap1', 'lap2', 'crossover', 'tower']
const step = Number(process.env.STEP ?? 20)
const out = process.env.OUT ?? 'shots'

const server = await createServer({ server: { port: 0 }, logLevel: 'warn' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
try {
  for (const lap of laps) {
    mkdirSync(`${out}/${lap}`, { recursive: true })
    await page.goto(`${base}?track=${lap}&freeze=1&renderer=webgl2`)
    await page.waitForFunction(() => window.driftline?.ready, null, { timeout: 60_000 })
    const poses = await page.evaluate((s) => window.driftline.centreline(s), step)
    for (const [i, p] of poses.entries()) {
      const yaw = (p.heading * 180) / Math.PI
      await page.goto(`${base}?track=${lap}&x=${p.x}&y=${p.y}&z=${p.z}&yaw=${yaw}&freeze=1&renderer=webgl2`)
      await page.waitForFunction(() => window.driftline?.ready, null, { timeout: 60_000 })
      await page.waitForTimeout(800) // let the chase camera settle
      const file = `${out}/${lap}/${String(i).padStart(3, '0')}.png`
      await page.screenshot({ path: file })
      console.log(file)
    }
  }
} finally {
  await browser.close()
  await server.close()
}
