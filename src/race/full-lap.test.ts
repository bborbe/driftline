// End-to-end: a simple pure-pursuit autopilot drives each shipped lap through the real physics and the
// real lap loop, start to finish. Proves the shipped track is completable as a lap.
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, TICK_HZ, trackSurface } from '../physics'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack as load } from './autopilot.test-driver'

// Lap-time window per track (ms) for this conservative autopilot. A human drives ~0.67x the
// autopilot's time (operator's first lap2 run: 36.05 s vs 53.7 s), so lap2's 67-90 s window is a
// ~45-60 s human lap; the floor also catches the track being shortened again.
const HUMAN_PACE = 0.67
const CASES = [
  { track: load('lap1'), minMs: 10_000, maxMs: 90_000 },
  { track: load('lap2'), minMs: 45_000 / HUMAN_PACE, maxMs: 60_000 / HUMAN_PACE },
  // Multi-level tracks: ~35 s human, the low end of the 35-55 s band in the design brief.
  { track: load('crossover'), minMs: 40_000, maxMs: 65_000 },
  { track: load('tower'), minMs: 40_000, maxMs: 65_000 },
]

describe.each(CASES)('$track.name end to end', ({ track, minMs, maxMs }) => {
  it('an autopilot completes a full lap: Begin, countdown, every checkpoint in order, finish, no respawn', () => {
    const loop = new LapLoop(track, () => true)
    const sim = new FixedStepper(loop.spawn(), trackSurface(track))
    const drive = autopilot(centreline(track))
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
    console.log(`${track.name} autopilot lap time: ${(lapTime / 1000).toFixed(2)} s`)
  })

  it('an autopilot completes a 3-lap run: LAP 1/3 → 3/3 with no respawn, total = sum of laps', () => {
    const loop = new LapLoop(track, () => true, 3)
    const sim = new FixedStepper(loop.spawn(), trackSurface(track))
    const drive = autopilot(centreline(track))
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
  })
})
