// End-to-end: a simple pure-pursuit autopilot drives each shipped lap through the real physics and the
// real lap loop, start to finish. Proves the shipped track is completable as a lap.
import { describe, expect, it } from 'vitest'
import { FixedStepper, materialUnder, NO_INPUT, TICK_HZ, trackSurface } from '../physics'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, hasLoop, HUMAN_PACE, loadTrack as load, surfaceLine, type Sample } from './autopilot.test-driver'
import { FREE_DRIVE, STYLES, TEST_TRACKS } from '../track/catalogue'
import type { Track } from '../track/schema'

// A whole simulated lap (a 3-lap run on the longest tracks) takes ~5 s on a CI runner, past vitest's
// 5 s default: give every lap test an explicit budget so slow runners do not flake.
const LAP_TIMEOUT = 30_000

// Lap-time window per track (ms) for this conservative autopilot. A human drives ~0.67x the
// autopilot's time (HUMAN_PACE; operator's first lap2 run: 36.05 s vs 53.7 s), so lap2's 67-90 s
// window is a ~45-60 s human lap; the floor also catches the track being shortened again.
// test-ramp: 120 m to the ramp (SC4 row 3, jump at ~135 km/h); test-flat: a 120 m straight with a
// turbo pad into a gentle r 150 m S-bend (row 4, steering at ~140 km/h), back through a medium
// r 40 m S (the 90 km/h drift corner). Autopilot ~34 s / ~75 s (it takes every curve at its 13 m/s
// pace; a human holds ~140 km/h through the wide S).
const RUN_UP: Record<string, [number, number]> = { 'test-ramp': [25_000, 45_000], 'test-flat': [55_000, 80_000] }

// authorOf: the track's author medal is this share of the autopilot lap, within 5 % (the campaign rule).
const CASES: { track: Track; minMs: number; maxMs: number; line?: (t: Track) => Sample[]; authorOf?: number }[] = [
  { track: load('test1'), minMs: 10_000, maxMs: 90_000 },
  { track: load('test2'), minMs: 45_000 / HUMAN_PACE, maxMs: 60_000 / HUMAN_PACE },
  // Single-feature test tracks: one mechanic each, a lap in at most 20 s even at autopilot pace.
  ...TEST_TRACKS.filter((n) => n.startsWith('test-') && !(n in RUN_UP) && !FREE_DRIVE.includes(n)).map((n) => ({ track: load(n), minMs: 5_000, maxMs: 20_000 })),
  // The two whose mechanic needs top speed: a full-throttle run-up from the grid (~130-140 km/h)
  // makes the lap longer than 20 s, and the return leg has to match it.
  ...Object.entries(RUN_UP).map(([n, [minMs, maxMs]]) => ({ track: load(n), minMs, maxMs })),
  // Multi-level campaign tracks: autopilot ~52.5 s (~35 s human, the low end of the brief's 35-55 s band).
  { track: load('crossover'), minMs: 40_000, maxMs: 65_000 },
  // Built only from kit pieces (assets/track/test-kit.json, src/track/kit.ts).
  { track: load('test-kit'), minMs: 10_000, maxMs: 40_000 },
  // Every kit piece type once: the catalogue track behind docs/track-kit.md.
  { track: load('test-kit-all'), minMs: 15_000, maxMs: 60_000 },
  { track: load('tower'), minMs: 40_000, maxMs: 65_000 },
  // Kit campaign levels A03-A05: autopilot ~56 / ~63 / ~73 s, a ~38 / ~42 / ~49 s human lap; medals at
  // crossover's and tower's ratios (author = 0.6 × autopilot, gold +8 %, silver +22 %, bronze +42 %).
  { track: load('plunge'), minMs: 45_000, maxMs: 70_000 },
  { track: load('knot'), minMs: 50_000, maxMs: 75_000 },
  { track: load('leap'), minMs: 55_000, maxMs: 85_000 },
  // Showcase: every set-piece in one lap (loop, spiral, wallride, gap-jump, turbo, the three corner
  // radii, a deck over the start straight). A ~35-55 s human lap; medals checked against this lap below.
  { track: load('showcase'), minMs: 50_000, maxMs: 85_000, authorOf: 0.6 },
  // Style tracks S01-S05, driven on the surface-aware line (tight kit corners, dirt and ice): a
  // 20-40 s human lap, washboard (LOL) 10-20 s. Autopilot ~38 / ~59 / ~39 / ~55 / ~25 s; medals at the
  // A03-A05 ratios.
  ...STYLES.map((l) => {
    const human = l.track === 'washboard' ? [10_000, 20_000] : [20_000, 40_000]
    return { track: load(l.track), minMs: human[0] / HUMAN_PACE, maxMs: human[1] / HUMAN_PACE, line: surfaceLine }
  }),
]

describe.each(CASES)('$track.name end to end', ({ track, minMs, maxMs, line = centreline, authorOf }) => {
  it('an autopilot completes a full lap: Begin, countdown, every checkpoint in order, finish, no respawn', () => {
    const loop = new LapLoop(track, () => true)
    const sim = new FixedStepper(loop.spawn(), trackSurface(track))
    const drive = autopilot(line(track), 0, hasLoop(track))
    const events: string[] = []
    let lapTime = 0
    loop.on({
      lapStart: () => events.push('start'),
      checkpoint: (_t, i) => events.push(`cp${i}`),
      respawn: () => events.push('respawn'),
      lapFinish: (_t, ms) => {
        events.push('finish')
        lapTime = ms
      },
    })
    loop.start(sim.state.tick)
    for (let i = 0; i < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; i++) {
      const raw = loop.phase === 'racing' ? drive(sim.state) : NO_INPUT
      advanceRace(loop, sim, 1 / TICK_HZ, raw)
    }
    const cps = track.gates.filter((g) => g.kind === 'checkpoint').map((_, i) => `cp${i + 1}`)
    expect(events).toEqual(['start', ...cps, 'finish'])

    // Behind the finish panel the car stays exactly where it crossed the line, with input held.
    const atFinish = sim.state
    expect(Math.hypot(atFinish.velocity.x, atFinish.velocity.z)).toBeGreaterThan(5) // it was moving
    for (let i = 0; i < 3 * TICK_HZ; i++) advanceRace(loop, sim, 1 / TICK_HZ, { ...NO_INPUT, throttle: 1, steer: 1 })
    expect(sim.state.position).toEqual(atFinish.position)
    expect(loop.phase).toBe('finished')
    expect(lapTime).toBeGreaterThan(minMs)
    expect(lapTime).toBeLessThan(maxMs)
    if (authorOf) expect(Math.abs(track.medals!.author / (authorOf * lapTime) - 1)).toBeLessThan(0.05)
    console.log(`${track.name} autopilot lap time: ${(lapTime / 1000).toFixed(2)} s`)
  }, LAP_TIMEOUT)

  it('an autopilot completes a 3-lap run: LAP 1/3 → 3/3 with no respawn, total = sum of laps', () => {
    const loop = new LapLoop(track, () => true, 3)
    const sim = new FixedStepper(loop.spawn(), trackSurface(track))
    const drive = autopilot(line(track), 0, hasLoop(track))
    const events: string[] = []
    let total = 0
    let times: number[] = []
    loop.on({
      lapStart: (_t, lap) => events.push(`lap${lap}`),
      respawn: () => events.push('respawn'),
      lapFinish: () => events.push('line'),
      raceFinish: (_t, ms, _best, lapTimes) => {
        total = ms
        times = lapTimes
      },
    })
    loop.start(sim.state.tick)
    for (let i = 0; i < COUNTDOWN_TICKS + 3 * 90 * TICK_HZ && loop.phase !== 'finished'; i++) {
      const raw = loop.phase === 'racing' ? drive(sim.state) : NO_INPUT
      advanceRace(loop, sim, 1 / TICK_HZ, raw)
    }
    expect(events).toEqual(['lap1', 'line', 'lap2', 'line', 'lap3', 'line'])
    expect(loop.phase).toBe('finished')
    expect(times).toHaveLength(3)
    for (const ms of times) expect(ms).toBeLessThan(maxMs)
    expect(total).toBeCloseTo(times[0] + times[1] + times[2], 6)
  }, LAP_TIMEOUT)
})

// The conservative autopilot slows to jump speed before every ramp; a human floors it. At full
// throttle the car flies ~60 m down crossover's landing slope; every gate must still count. leap and
// test-kit-all jump the kit's gap-jump piece, crossover's jump on the grid.
describe.each(['crossover', 'leap', 'test-kit-all', 'showcase'])('%s gap jump at full throttle', (name) => {
  it('a car flat out from the run-up over the gap still scores every gate and finishes', () => {
    const track = load(name)
    const gapAt = track.segments.findIndex((s) => s.type === 'gap')
    // centreline() emits 20 samples per segment: no slowdown from the descent straight to the landing.
    const samples = centreline(track).map((s, k) => {
      const seg = Math.floor(k / 20)
      return seg >= gapAt - 2 && seg <= gapAt + 1 ? { ...s, speed: 60 } : s
    })
    const loop = new LapLoop(track, () => true)
    const sim = new FixedStepper(loop.spawn(), trackSurface(track))
    const drive = autopilot(samples, 0, hasLoop(track))
    const events: string[] = []
    let peak = 0
    loop.on({ checkpoint: (_t, i) => events.push(`cp${i}`), respawn: () => events.push('respawn'), lapFinish: () => events.push('finish') })
    loop.start(sim.state.tick)
    for (let i = 0; i < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; i++) {
      advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
      peak = Math.max(peak, Math.hypot(sim.state.velocity.x, sim.state.velocity.z))
    }
    const cps = track.gates.filter((g) => g.kind === 'checkpoint').map((_, i) => `cp${i + 1}`)
    expect(events).toEqual([...cps, 'finish'])
    expect(peak).toBeGreaterThan(30) // it really was flat out, not the 18 m/s jump speed
  }, LAP_TIMEOUT)
})

// Fullspeed (S02 flatout): throttle held and the brake never touched from GO to the finish. The
// autopilot steers (its 0.5 s time aim: a short fixed aim weaves at 38 m/s); it never lifts.
describe('flatout at full throttle, no brake', () => {
  it('a car flat out all lap scores every gate in order, never respawns and stays on the road', () => {
    const track = load('flatout')
    const loop = new LapLoop(track, () => true)
    const surface = trackSurface(track)
    const sim = new FixedStepper(loop.spawn(), surface)
    const drive = autopilot(surfaceLine(track), 0.5)
    const events: string[] = []
    let ticks = 0
    let offroad = 0
    let peak = 0
    loop.on({ checkpoint: (_t, i) => events.push(`cp${i}`), respawn: () => events.push('respawn'), lapFinish: () => events.push('finish') })
    loop.start(sim.state.tick)
    for (let i = 0; i < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; i++) {
      const racing = loop.phase === 'racing'
      advanceRace(loop, sim, 1 / TICK_HZ, racing ? { ...drive(sim.state), throttle: 1, brake: 0 } : NO_INPUT)
      if (racing) {
        ticks++
        if (materialUnder(sim.state, surface) === 'offroad') offroad++
        peak = Math.max(peak, Math.hypot(sim.state.velocity.x, sim.state.velocity.z))
      }
    }
    const cps = track.gates.filter((g) => g.kind === 'checkpoint').map((_, i) => `cp${i + 1}`)
    expect(events).toEqual([...cps, 'finish'])
    expect(offroad / ticks).toBeLessThan(0.05)
    expect(peak).toBeGreaterThan(35) // really flat out, near the 40 m/s top speed
  }, LAP_TIMEOUT)
})
