// The test tracks for SC4 rows 3 and 4 give a full-throttle run-up from the grid, so the mechanic is
// driven at real speed: test-ramp reaches its ramp at ~135 km/h (the crossover gap jump is 130,
// top speed 147), test-flat its S-bend (two r 150 m 45° curves, 40 m apart) at ~140 km/h and holds it through. Operator, 2026-10-17:
// "the start point of the track is so close to the ramp that I don't get enough speed to really jump".
import { describe, expect, it } from 'vitest'
import { FixedStepper, length, NO_INPUT, TICK_HZ, trackSurface } from '../physics'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack } from './autopilot.test-driver'
import { poses, type Track } from '../track/schema'

const KMH = 3.6

// Flat out from the grid on the autopilot's line (and one segment past `to`, so its braking for the
// next corner starts after the window); the speed (km/h) at the
// entry of segment `at`, and the lowest speed from there to the entry of segment `to`.
function runUp(track: Track, at: number, to: number): { entry: number; min: number } {
  const line = centreline(track).map((s, k) => (Math.floor(k / 20) <= to + 1 ? { ...s, speed: 60 } : s))
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const drive = autopilot(line)
  const p = poses(track)
  // Distance along the run-up's heading (+z from the grid): both run-ups start straight down +z.
  const zAt = p[at].z
  const zTo = p[to].z
  loop.start(sim.state.tick)
  let entry = 0
  let min = Infinity
  for (let i = 0; i < COUNTDOWN_TICKS + 30 * TICK_HZ && sim.state.position.z < zTo; i++) {
    advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
    const z = sim.state.position.z
    const v = length(sim.state.velocity) * KMH
    if (z >= zAt) {
      if (!entry) entry = v
      min = Math.min(min, v)
    }
  }
  return { entry, min }
}

describe('SC4 test-track run-ups', () => {
  it('test-ramp: flat out from the grid reaches the ramp at 130-147 km/h', () => {
    const track = loadTrack('test-ramp')
    const { entry } = runUp(track, track.segments.findIndex((s) => s.type === 'ramp'), 2)
    expect(entry).toBeGreaterThan(130)
    expect(entry).toBeLessThan(147)
  })

  it('test-flat: flat out from the grid reaches the S-bend at 135-147 km/h and keeps ≥ 130 through it', () => {
    const track = loadTrack('test-flat')
    const first = track.segments.findIndex((s) => s.type === 'curve')
    const { entry, min } = runUp(track, first, first + 3) // curve, straight, curve: to the straight after the S
    expect(entry).toBeGreaterThan(135)
    expect(entry).toBeLessThan(147)
    expect(min).toBeGreaterThan(130)
  })
})
