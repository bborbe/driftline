// Live drive: autopilot the car round a lap in a real browser and screenshot every named state change (CP n, surface).
// A playwright-cli run-code file, for verifying motion effects (sparks, dust, drift cue, checkpoint flash) that frozen
// debug poses and `make shots` cannot show. Usage (always a muted browser in its own session):
//   playwright-cli -s=live-drive open --config=scripts/live-drive.config.json
//   playwright-cli -s=live-drive goto 'https://bborbe.github.io/driftline/?track=test-surfaces'   # optional: pick base + track
//   playwright-cli -s=live-drive run-code --filename=scripts/live-drive.js
//   playwright-cli -s=live-drive close
// Without a driftline page open it drives test-checkpoint on the live site. Shots land in shots/live-drive/ (gitignored).
async (page) => {
  const DEFAULT_BASE = 'https://bborbe.github.io/driftline/'
  const DEFAULT_TRACK = 'test-checkpoint'
  const CAP = 55 // km/h: slow enough to follow the centreline without hitting the rails
  const SECONDS = 45 // drive time after GO
  const PAUSE = 50 // ms per step; a loop with no pause starves the game's frame loop and the car crawls
  const AHEAD = 6 // centreline points (2 m apart) past the nearest one to steer at
  const DEAD = 4 // degrees of heading error left unsteered
  const OUT = 'shots/live-drive'

  // Base and track: from the open page when it is a driftline page, else the defaults.
  const open = new URL(page.url().startsWith('http') ? page.url() : DEFAULT_BASE)
  const base = open.searchParams.has('track') ? `${open.origin}${open.pathname}` : DEFAULT_BASE
  const track = open.searchParams.get('track') ?? DEFAULT_TRACK
  // vol=0 keeps the game silent even if the browser was not started with --mute-audio; debug=1 shows the pose line.
  await page.goto(`${base}?track=${track}&vol=0&debug=1&renderer=webgl2`)
  await page.waitForFunction(() => window.driftline?.ready, null, { timeout: 60_000 })
  const line = await page.evaluate(() => window.driftline.centreline(2))

  // One read per step, of three elements only: polling document.body.innerText is slow enough to starve frames too.
  const read = () =>
    page.evaluate(() => ({
      hud: document.getElementById('hud')?.textContent ?? '',
      cp: document.querySelector('.race-cp')?.textContent ?? '',
      speed: Number(document.querySelector('.race-speed')?.textContent ?? 0),
    }))
  // Debug line: `... x 1.0  y 0.8  z 2.0  yaw 90[  up 0.95][  dirt][  TURBO]`; road is not printed.
  const parse = (hud) => {
    const m = hud.match(/x (-?[\d.]+)\s+y (-?[\d.]+)\s+z (-?[\d.]+)\s+yaw (-?\d+)(?:\s+up -?[\d.]+)?(?:\s+([a-z]+))?/)
    return m && { x: +m[1], y: +m[2], z: +m[3], yaw: +m[4], material: m[5] ?? 'road' }
  }

  const held = new Set()
  const hold = async (key, on) => {
    if (on === held.has(key)) return
    if (on) {
      await page.keyboard.down(key)
      held.add(key)
    } else {
      await page.keyboard.up(key)
      held.delete(key)
    }
  }

  await page.keyboard.press('Enter') // Begin: 3-2-1-GO
  await page.waitForTimeout(3200)

  const shots = []
  let state = ''
  let near = 0
  let still = 0
  const end = Date.now() + SECONDS * 1000
  while (Date.now() < end) {
    const r = await read()
    const p = parse(r.hud)
    if (p) {
      // Nearest centreline point, searched around the last one so a crossing part of the lap never steals it.
      let best = Infinity
      const from = near
      for (let d = -10; d <= 30; d++) {
        const i = (from + d + line.length) % line.length
        const q = line[i]
        const dist = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2
        if (dist < best) [best, near] = [dist, i]
      }
      const t = line[(near + AHEAD) % line.length]
      // Yaw convention: 0 = +z, CCW positive (docs/development.md § Debug screenshots); A turns toward positive yaw.
      const want = (Math.atan2(t.x - p.x, t.z - p.z) * 180) / Math.PI
      const err = ((want - p.yaw + 540) % 360) - 180
      await hold('KeyA', err > DEAD)
      await hold('KeyD', err < -DEAD)
      await hold('KeyW', r.speed < CAP)

      // Stuck against a rail for ~2 s: respawn at the last checkpoint.
      still = r.speed === 0 ? still + 1 : 0
      if (still > 40) {
        await page.keyboard.press('KeyR')
        still = 0
      }

      const now = `${r.cp} ${p.material}`
      if (now !== state) {
        state = now
        const file = `${OUT}/${track}-${String(shots.length).padStart(2, '0')}-${now.replace(/\W+/g, '-')}.png`
        await page.screenshot({ path: file })
        shots.push({ file, cp: r.cp, material: p.material, speed: r.speed })
      }
    }
    await page.waitForTimeout(PAUSE)
  }
  for (const k of [...held]) await hold(k, false)
  return shots
}
