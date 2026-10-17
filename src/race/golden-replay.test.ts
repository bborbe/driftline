// Pin of every track shipped before the loop (golden-replay.json, captured from the unchanged master
// eca6adf code): each drives the same autopilot lap through the real path (advanceRace) and must
// finish on the same tick, with the car within TOLERANCE of the captured position every SAMPLE ticks.
// A physics change that leaks outside its own piece moves a lap by centimetres to metres and fails here.
// Not a bit-exact hash: Math.sin/cos/atan2 round differently in the last bit across Node versions,
// OSes and CPUs (measured 2026-10-17: macOS arm64 node 22.22.3, linux arm64 and linux x64 node
// 22.23.3 shared no state hash on any of the 21 tracks, at equal tick counts, while their positions
// stayed within 1 µm all lap), so a hash pinned on one machine failed CI on another.
// Re-capture only when a change is meant to move these tracks:
//   UPDATE_GOLDEN=1 npx vitest run src/race/golden-replay.test.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, TICK_HZ, trackSurface } from '../physics'
import { STYLES } from '../track/catalogue'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack, surfaceLine } from './autopilot.test-driver'

/** Ticks between position samples. */
const SAMPLE = 50
/** Allowed distance from a captured sample (m): 10× the cross-platform drift, far below any real change. */
const TOLERANCE = 1e-5

type Golden = { ticks: number; positions: [number, number, number][] }
const FILE = new URL('./golden-replay.json', import.meta.url)

// One autopilot lap on the same line full-lap.test.ts drives (surface-aware on the style tracks).
const replay = (name: string): Golden => {
  const track = loadTrack(name)
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const drive = autopilot((STYLES.some((l) => l.track === name) ? surfaceLine : centreline)(track))
  loop.start(sim.state.tick)
  const positions: [number, number, number][] = []
  let ticks = 0
  for (; ticks < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; ticks++) {
    advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
    const p = sim.state.position
    if (ticks % SAMPLE === 0) positions.push([p.x, p.y, p.z])
  }
  return { ticks, positions }
}

describe('shipped tracks replay unchanged', () => {
  if (process.env.UPDATE_GOLDEN === '1') {
    it('captures the golden laps of every track in assets/track', () => {
      const names = readdirSync(new URL('../../assets/track/', import.meta.url))
        .filter((f) => f.endsWith('.json') && f !== 'pieces.json')
        .map((f) => f.slice(0, -'.json'.length))
        .sort()
      writeFileSync(FILE, JSON.stringify(Object.fromEntries(names.map((n) => [n, replay(n)]))) + '\n')
    })
    return
  }
  const golden: Record<string, Golden> = JSON.parse(readFileSync(FILE, 'utf8'))
  it('pins the 21 tracks shipped before the loop', () => {
    expect(Object.keys(golden)).toHaveLength(21)
  })
  it.each(Object.keys(golden))('%s', (name) => {
    const run = replay(name)
    expect(run.ticks).toBe(golden[name].ticks)
    expect(run.positions).toHaveLength(golden[name].positions.length)
    const worst = Math.max(...run.positions.map((p, i) => Math.hypot(...p.map((v, k) => v - golden[name].positions[i][k]))))
    expect(worst).toBeLessThan(TOLERANCE)
  })
})
