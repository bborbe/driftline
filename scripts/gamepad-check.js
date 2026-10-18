// Gamepad check: a mocked `navigator.getGamepads` (one standard-mapping pad) drives the game in a real browser — menu
// navigation from the start screen into a race, then throttle, steer and respawn — asserting each step and screenshotting
// it. A playwright-cli run-code file, like live-drive.js. Usage (always a muted browser in its own session):
//   playwright-cli -s=gamepad open --config=scripts/gamepad-check.config.json
//   playwright-cli -s=gamepad goto 'http://localhost:5173/'          # optional: pick the base (default: the live site)
//   playwright-cli -s=gamepad run-code --filename=scripts/gamepad-check.js
//   playwright-cli -s=gamepad close
// Shots land in shots/gamepad/ (gitignored). Prints one PASS / FAIL line per step and throws on the first failure.
async (page) => {
  const DEFAULT_BASE = 'https://bborbe.github.io/driftline/'
  const OUT = 'shots/gamepad'
  const open = page.url().startsWith('http') ? new URL(page.url()) : new URL(DEFAULT_BASE)
  const base = `${open.origin}${open.pathname}`

  // The fake pad: 17 buttons and 4 axes on window.__pad, returned by getGamepads() from the first frame on.
  await page.addInitScript(() => {
    const pad = {
      id: 'Mock Xbox Controller (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    }
    window.__pad = pad
    navigator.getGamepads = () => [pad, null, null, null]
  })
  const setButton = (i, v) =>
    page.evaluate(([i, v]) => {
      window.__pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v }
    }, [i, v])
  const setAxis = (i, v) => page.evaluate(([i, v]) => (window.__pad.axes[i] = v), [i, v])
  const tap = async (i) => {
    await setButton(i, 1)
    await page.waitForTimeout(120)
    await setButton(i, 0)
    await page.waitForTimeout(120)
  }
  const A = 0, B = 1, RT = 7, RIGHT = 15
  const pose = async () => {
    const hud = await page.evaluate(() => document.getElementById('hud')?.textContent ?? '')
    const m = hud.match(/x (-?[\d.]+)\s+y (-?[\d.]+)\s+z (-?[\d.]+)\s+yaw (-?\d+)/)
    return m && { x: +m[1], z: +m[3], yaw: +m[4] }
  }
  const speed = () => page.evaluate(() => Number(document.querySelector('.race-speed')?.textContent ?? 0))
  const results = []
  const check = (name, ok, detail) => {
    results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
    if (!ok) throw new Error(results.join('\n'))
  }
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })

  // 1. Start screen: the toast, then the d-pad moves focus and A picks the focused track.
  await page.goto(`${base}?vol=0&debug=1&renderer=webgl2`)
  await page.waitForSelector('#start-menu .menu-focus', { timeout: 60_000 })
  await page.waitForTimeout(300)
  const toast = await page.evaluate(() => {
    const t = document.getElementById('pad-toast')
    return t && !t.hidden ? t.textContent : null
  })
  check('toast on connect', toast === 'Controller connected', String(toast))
  await shot('1-menu-toast')
  const before = await page.evaluate(() => document.querySelector('#start-menu .menu-focus')?.dataset.track)
  await tap(RIGHT)
  const focused = await page.evaluate(() => document.querySelector('#start-menu .menu-focus')?.dataset.track)
  check('d-pad → moves the track focus', !!focused && focused !== before, `${before} → ${focused}`)
  await shot('2-menu-dpad')
  await tap(A)
  await page.waitForFunction(() => window.driftline?.ready && window.driftline.mode === 'race', null, { timeout: 60_000 })
  check('A picks the focused track', new URL(page.url()).searchParams.get('track') === focused, page.url())
  // Another track than the menu scene's loads its own page, which opens on READY?: A presses Begin there too.
  if (await page.evaluate(() => !!document.getElementById('begin'))) {
    await page.waitForTimeout(300)
    await tap(A)
    check('A presses Begin', await page.evaluate(() => !document.getElementById('begin')))
  }

  // 2. Race: wait out the countdown, then RT drives, the stick steers, B respawns.
  await page.waitForTimeout(4200)
  const start = await pose()
  await setButton(RT, 1)
  await page.waitForTimeout(1500)
  const v = await speed()
  check('RT throttles', v > 20, `${v} km/h`)
  await setAxis(0, -1)
  await page.waitForTimeout(500)
  await setAxis(0, 0)
  await setButton(RT, 0)
  const turned = await pose()
  check('left stick steers', !!start && !!turned && turned.yaw !== start.yaw, `yaw ${start?.yaw} → ${turned?.yaw}`)
  await shot('3-race-driving')
  await tap(B)
  await page.waitForTimeout(300)
  const back = await pose()
  const dist = back && start ? Math.hypot(back.x - start.x, back.z - start.z) : Infinity
  check('B respawns at the last checkpoint (the grid, before the first)', dist < 2, `${dist.toFixed(2)} m from the grid`)
  await shot('4-race-respawn')
  console.log(results.join('\n'))
  return results.join('\n')
}
