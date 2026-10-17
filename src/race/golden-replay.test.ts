// Bit-identical pin: every track shipped before the loop (golden-replay.json, captured on unchanged
// master eca6adf) drives the same autopilot lap through the real path (advanceRace) and must hash to
// the same per-tick car state. A physics change that leaks outside its own piece flips a hash here.
// Re-capture only when a change is meant to move these tracks:
//   UPDATE_GOLDEN=1 npx vitest run src/race/golden-replay.test.ts
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, TICK_HZ, trackSurface, type CarState } from '../physics'
import { STYLES } from '../track/catalogue'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack, surfaceLine } from './autopilot.test-driver'

type Golden = { ticks: number; sha256: string }
const FILE = new URL('./golden-replay.json', import.meta.url)

const bits = (s: CarState): Float64Array =>
  new Float64Array([
    s.position.x, s.position.y, s.position.z,
    s.velocity.x, s.velocity.y, s.velocity.z,
    s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w,
    s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z,
    s.steerAngle, s.tick, s.turbo, s.turboForce,
  ])

// One autopilot lap on the same line full-lap.test.ts drives (surface-aware on the style tracks).
const replay = (name: string): Golden => {
  const track = loadTrack(name)
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const drive = autopilot((STYLES.some((l) => l.track === name) ? surfaceLine : centreline)(track))
  const hash = createHash('sha256')
  loop.start(sim.state.tick)
  let ticks = 0
  for (; ticks < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; ticks++) {
    advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
    hash.update(bits(sim.state))
  }
  return { ticks, sha256: hash.digest('hex') }
}

describe('shipped tracks replay bit-identically', () => {
  if (process.env.UPDATE_GOLDEN === '1') {
    it('captures the golden hashes of every track in assets/track', () => {
      const names = readdirSync(new URL('../../assets/track/', import.meta.url))
        .filter((f) => f.endsWith('.json') && f !== 'pieces.json')
        .map((f) => f.slice(0, -'.json'.length))
        .sort()
      writeFileSync(FILE, JSON.stringify(Object.fromEntries(names.map((n) => [n, replay(n)])), null, 2) + '\n')
    })
    return
  }
  const golden: Record<string, Golden> = JSON.parse(readFileSync(FILE, 'utf8'))
  it('pins the 21 tracks shipped before the loop', () => {
    expect(Object.keys(golden)).toHaveLength(21)
  })
  it.each(Object.keys(golden))('%s', (name) => {
    expect(replay(name)).toEqual(golden[name])
  })
})
