// Countdown timing as the player sees it, through the real path (index.ts frame(): Begin → loop.start,
// Delete / Esc → Restart / finish → Improve → loop.restart, then advanceRace on the fixed stepper):
// every countdown shows 3, 2, 1, GO one second apart, at any display rate. Track change reloads the page,
// so it is the Begin path on a fresh loop.
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, trackSurface } from '../physics'
import { advanceRace, LapLoop } from './lap'
import { autopilot, centreline, hasLoop, loadTrack } from './autopilot.test-driver'

const track = loadTrack('looping')

// Frame-driven run: `dt` seconds per frame, wall time = frames · dt. Records the wall time of each countdown step.
function harness(dt: number) {
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const drive = autopilot(centreline(track), 0, hasLoop(track))
  let now = 0
  let steps: [number, number][] = []
  loop.on({ countdown: (_t, n) => steps.push([n, now]) })
  const frame = () => {
    now += dt
    advanceRace(loop, sim, dt, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
  }
  const countdown = (): [number, number][] => {
    while (loop.phase === 'countdown') frame()
    const out = steps
    steps = []
    return out
  }
  return {
    loop,
    frame,
    begin: () => {
      loop.start(sim.state.tick)
      return countdown()
    },
    // index.ts frame(): a pending restart replaces the car state before advancing.
    restart: () => {
      sim.state = loop.restart(sim.state.tick)
      return countdown()
    },
  }
}

// 3, 2, 1, GO with each step 1.0 s after the previous, within one frame plus one physics tick.
function expectOneSecondSteps(steps: [number, number][], dt: number) {
  expect(steps.map(([n]) => n)).toEqual([3, 2, 1, 0])
  const gaps = steps.slice(1).map(([, t], i) => t - steps[i][1])
  for (const gap of gaps) expect(Math.abs(gap - 1)).toBeLessThanOrEqual(dt + 0.01 + 1e-9)
}

describe.each([60, 144])('countdown at %i Hz display', (hz) => {
  const dt = 1 / hz

  it('Begin (also every track change): 3, 2, 1, GO one second apart', () => {
    expectOneSecondSteps(harness(dt).begin(), dt)
  })

  it('restart while racing (Delete, Esc → Restart): 3, 2, 1, GO one second apart', () => {
    const h = harness(dt)
    h.begin()
    for (let i = 0; i < 2 * hz; i++) h.frame() // drive for 2 s
    expect(h.loop.phase).toBe('racing')
    expectOneSecondSteps(h.restart(), dt)
  })

  it('restart from the finish screen (Improve): 3, 2, 1, GO one second apart', () => {
    const h = harness(dt)
    h.begin()
    for (let i = 0; i < 120 * hz && h.loop.phase !== 'finished'; i++) h.frame()
    expect(h.loop.phase).toBe('finished')
    expectOneSecondSteps(h.restart(), dt)
  })

  it('back-to-back restarts each get the full countdown', () => {
    const h = harness(dt)
    h.begin()
    for (let i = 0; i < 3; i++) expectOneSecondSteps(h.restart(), dt)
  })
})
