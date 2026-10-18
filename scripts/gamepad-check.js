// Gamepad check: a mocked `navigator.getGamepads` (one standard-mapping pad) drives the game in a real browser, pad only —
// no keyboard, no mouse: start menu (d-pad focus, Settings with LB / RB tabs, the focus ring and ←/→ on a control, B
// back), a race (Begin, throttle, steer, respawn, a pad-driven lap of test-checkpoint), the results card (name entry
// saved with A, skipped with B on a second lap), the results menu, the leaderboard (X), the Esc menu and its Settings,
// and Back to menu. Asserts each step and screenshots it. A playwright-cli run-code file, like live-drive.js. Usage
// (always a muted browser in its own session):
//   playwright-cli -s=gamepad open --config=scripts/gamepad-check.config.json
//   playwright-cli -s=gamepad goto 'http://localhost:5173/'          # optional: pick the base (default: the live site)
//   playwright-cli -s=gamepad run-code --filename=scripts/gamepad-check.js
//   playwright-cli -s=gamepad close
// Shots land in shots/gamepad/ (gitignored). Prints one PASS / FAIL line per step and throws on the first failure.
async (page) => {
  const DEFAULT_BASE = 'https://bborbe.github.io/driftline/'
  const OUT = 'shots/gamepad'
  const LAP_TRACK = 'test-checkpoint'
  const CAP = 55 // km/h: slow enough for the stick to follow the centreline without hitting the rails
  const open = page.url().startsWith('http') ? new URL(page.url()) : new URL(DEFAULT_BASE)
  const base = `${open.origin}${open.pathname}`
  // vol=0 keeps the game silent; fps=30 and quality=low keep a driven tab cheap (AGENTS.md § Driven browsers).
  const COMMON = 'vol=0&debug=1&renderer=webgl2&fps=30&quality=low'

  // The fake pad: 17 buttons and 4 axes on window.__pad, returned by getGamepads() from the first frame on; a fresh
  // profile each run, so the name entry always qualifies and settings start at their defaults.
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
    await page.waitForTimeout(150)
  }
  const A = 0, B = 1, X = 2, LB = 4, RB = 5, RT = 7, MENU = 9, UP = 12, DOWN = 13, RIGHT = 15
  const js = (fn, arg) => page.evaluate(fn, arg)
  const pose = async () => {
    const hud = await js(() => document.getElementById('hud')?.textContent ?? '')
    const m = hud.match(/x (-?[\d.]+)\s+y (-?[\d.]+)\s+z (-?[\d.]+)\s+yaw (-?\d+)/)
    return m && { x: +m[1], z: +m[3], yaw: +m[4] }
  }
  const speed = () => js(() => Number(document.querySelector('.race-speed')?.textContent ?? 0))
  const ring = () => js(() => {
    const el = document.querySelector('.pad-focus')
    return el ? { tag: el.tagName, id: el.id, value: el.value ?? null } : null
  })
  const results = []
  const check = (name, ok, detail) => {
    results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
    if (!ok) throw new Error(results.join('\n'))
  }
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })

  // 1. Start screen: the toast, then the d-pad moves focus.
  await page.goto(`${base}?${COMMON}`)
  await js(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('#start-menu .menu-focus', { timeout: 60_000 })
  await page.waitForTimeout(300)
  const toast = await js(() => {
    const t = document.getElementById('pad-toast')
    return t && !t.hidden ? t.textContent : null
  })
  check('toast on connect', toast === 'Controller connected', String(toast))
  await shot('01-menu-toast')
  const focusedTile = () => js(() => document.querySelector('#start-menu .menu-focus')?.dataset.track ?? null)
  const before = await focusedTile()
  await tap(RIGHT)
  const moved = await focusedTile()
  check('d-pad → moves the track focus', !!moved && moved !== before, `${before} → ${moved}`)

  // 2. Settings from the start menu: ↓ to the SETTINGS button, A opens, RB / LB switch tabs, ↓ rings a control, → adjusts it, B closes.
  for (let i = 0; i < 6 && (await focusedTile()) !== null; i++) await tap(DOWN)
  check('d-pad ↓ reaches SETTINGS', await js(() => !!document.querySelector('#start-menu .menu-settings-button.menu-focus')))
  await tap(A)
  check('A opens Settings', await js(() => !document.getElementById('start-settings').hidden))
  const tab = () => js(() => document.querySelector('#start-settings .menu-tab-active')?.id ?? null)
  const tab0 = await tab()
  await tap(RB)
  const tab1 = await tab()
  check('RB switches to the next tab', tab1 !== null && tab1 !== tab0, `${tab0} → ${tab1}`)
  await tap(LB)
  check('LB switches back', (await tab()) === tab0, String(await tab()))
  // The Race tab: a select first (Time of day) — the ring lands on it and → changes its value.
  while ((await tab()) !== 'setting-tab-race') await tap(RB)
  await tap(DOWN)
  const r0 = await ring()
  check('d-pad ↓ puts the focus ring on a control', r0?.tag === 'SELECT', JSON.stringify(r0))
  await tap(RIGHT)
  const r1 = await ring()
  check('d-pad → changes the focused setting', r1?.id === r0.id && r1.value !== r0.value, `${r0.id}: ${r0.value} → ${r1?.value}`)
  await shot('02-menu-settings-ring')
  // The ghost checkboxes: ↓ to one, A toggles it.
  for (let i = 0; i < 6 && (await ring())?.tag !== 'INPUT'; i++) await tap(DOWN)
  const cb = await js(() => {
    const el = document.querySelector('.pad-focus')
    return el ? { id: el.id, checked: el.checked } : null
  })
  await tap(A)
  const cb2 = await js(() => document.querySelector('.pad-focus')?.checked)
  check('A toggles the focused checkbox', !!cb && cb.id.startsWith('setting-ghost-') && cb2 === !cb.checked, `${cb?.id} ${cb?.checked} → ${cb2}`)
  await tap(B)
  check('B closes Settings', await js(() => document.getElementById('start-settings').hidden))
  await tap(UP)
  check('d-pad ↑ leaves SETTINGS for the tracks again', (await focusedTile()) !== null, String(await focusedTile()))
  await shot('03-menu-back')
  await tap(A)
  await page.waitForFunction(() => window.driftline?.ready && window.driftline.mode === 'race', null, { timeout: 60_000 })
  check('A picks the focused track', !!new URL(page.url()).searchParams.get('track'), page.url())

  // 3. A race lap on a short test track: Begin with A, then RT + stick round the lap, B respawns on the way.
  const line = async () => js(() => window.driftline.centreline(2))
  const begin = async () => {
    await page.waitForFunction(() => window.driftline?.ready, null, { timeout: 60_000 })
    if (await js(() => !!document.getElementById('begin'))) {
      await page.waitForTimeout(300)
      await tap(A)
      check('A presses Begin', await js(() => !document.getElementById('begin')))
    }
    await page.waitForTimeout(3300)
  }
  // Steer at the centreline 6 points (12 m) ahead until the results card is up.
  const driveLap = async (pts) => {
    let near = 0
    const end = Date.now() + 90_000
    while (Date.now() < end) {
      if (await js(() => window.driftline.mode === 'results')) break
      const p = await pose()
      if (!p) {
        await page.waitForTimeout(50)
        continue
      }
      let best = Infinity
      for (let k = 0; k < 40; k++) {
        const i = (near + k) % pts.length
        const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z)
        if (d < best) [best, near] = [d, i]
      }
      const t = pts[(near + 6) % pts.length]
      const err = ((((Math.atan2(t.x - p.x, t.z - p.z) * 180) / Math.PI - p.yaw + 540) % 360) - 180)
      await setButton(RT, (await speed()) < CAP ? 1 : 0)
      await setAxis(0, Math.abs(err) < 4 ? 0 : Math.max(-1, Math.min(1, -err / 25)))
      await page.waitForTimeout(50)
    }
    await setButton(RT, 0)
    await setAxis(0, 0)
    check('a pad-driven lap reaches the results card', await js(() => window.driftline.mode === 'results'))
    await page.waitForFunction(() => !!document.querySelector('#results-card input, #results-card .race-results-actions'), null, { timeout: 10_000 })
  }

  await page.goto(`${base}?track=${LAP_TRACK}&${COMMON}`)
  await begin()
  const start = await pose()
  await setButton(RT, 1)
  await page.waitForTimeout(1500)
  const v = await speed()
  check('RT throttles', v > 20, `${v} km/h`)
  await setAxis(0, -1)
  await page.waitForTimeout(400)
  await setAxis(0, 0)
  await setButton(RT, 0)
  const turned = await pose()
  check('left stick steers', !!start && !!turned && turned.yaw !== start.yaw, `yaw ${start?.yaw} → ${turned?.yaw}`)
  await shot('04-race-driving')
  await tap(B)
  await page.waitForTimeout(300)
  const back = await pose()
  const dist = back && start ? Math.hypot(back.x - start.x, back.z - start.z) : Infinity
  check('B respawns at the last checkpoint (the grid, before the first)', dist < 2, `${dist.toFixed(2)} m from the grid`)
  const pts = await line()
  await driveLap(pts)

  // 4. Results: the name entry is up (a fresh profile qualifies); A saves the name, then the results menu takes the pad.
  check('the name entry is up', await js(() => !!document.querySelector('#results-card input')))
  await shot('05-results-name')
  await tap(A)
  const saved = await js(() => document.querySelector('#results-card .race-mine')?.textContent ?? null)
  check('A saves the name to the board', !!saved && saved.includes('on board'), String(saved))
  check('the results menu follows', await js(() => !!document.querySelector('.race-results-actions .menu-focus')))
  await shot('06-results-saved')
  const item = () => js(() => document.querySelector('.race-results-actions .menu-focus')?.textContent ?? null)
  const i0 = await item()
  await tap(DOWN)
  check('d-pad ↓ moves the results menu', (await item()) !== i0, `${i0} → ${await item()}`)
  await tap(UP)
  check('Restart is focused', (await item()) === 'Restart', String(await item()))
  await tap(A)
  await page.waitForFunction(() => window.driftline.mode === 'race', null, { timeout: 10_000 })
  check('A on Restart races again', true)

  // 5. Leaderboard: X opens and closes the top 10 while racing.
  await page.waitForTimeout(3300)
  await tap(X)
  const board = await js(() => document.querySelector('.race-board')?.textContent ?? null)
  check('X opens the leaderboard', !!board && board.includes('TOP 10'), String(board))
  await shot('07-race-leaderboard')
  await tap(X)
  check('X closes it', await js(() => !document.querySelector('.race-board')?.isConnected || document.querySelector('.race-board').closest('[hidden]') !== null))

  // 6. A second lap: B skips the name entry, no board entry, and the results menu follows.
  await driveLap(pts)
  if (await js(() => !!document.querySelector('#results-card input'))) {
    await tap(B)
    const line2 = await js(() => document.querySelector('.race-results-entry')?.textContent ?? null)
    check('B skips the name entry', line2 === 'Not saved to the board', String(line2))
  }
  check('the results menu takes the pad after a skip', await js(() => !!document.querySelector('.race-results-actions .menu-focus')))
  await shot('08-results-skipped')
  await tap(A) // Restart
  await page.waitForFunction(() => window.driftline.mode === 'race', null, { timeout: 10_000 })

  // 7. The Esc menu: Menu pauses, ↓ to Settings, A opens it, the ring adjusts a control, B closes it, B resumes.
  await page.waitForTimeout(3300)
  await tap(MENU)
  const pauseItem = () => js(() => document.querySelector('.race-pause .menu-focus')?.textContent ?? null)
  check('Menu pauses', (await pauseItem()) === 'Resume', String(await pauseItem()))
  while ((await pauseItem()) !== 'Settings') await tap(DOWN)
  await tap(A)
  const pauseRing0 = await ring()
  await tap(DOWN)
  const p0 = await ring()
  check('the Esc menu Settings takes the focus ring', !!p0 && pauseRing0 === null, JSON.stringify(p0))
  check('d-pad ↓ in Settings leaves the Esc list alone', (await pauseItem()) === 'Settings', String(await pauseItem()))
  await shot('09-pause-settings-ring')
  await tap(B)
  check('B closes the Esc menu Settings', !(await ring()) || (await js(() => document.querySelector('.pad-focus')?.getClientRects().length === 0)))
  await tap(B)
  check('B resumes', await js(() => window.driftline.mode === 'race' && document.querySelector('.race-pause').hidden))

  // 8. Back to menu: Menu, ↓ to Back to menu, A — the start menu is up again.
  await tap(MENU)
  while ((await pauseItem()) !== 'Back to menu') await tap(DOWN)
  await tap(A)
  await page.waitForSelector('#start-menu .menu-focus', { timeout: 60_000 })
  check('A on Back to menu returns to the start menu', await js(() => window.driftline?.mode === 'menu' || !!document.getElementById('start-menu')))
  await shot('10-menu-again')
  console.log(results.join('\n'))
  return results.join('\n')
}
