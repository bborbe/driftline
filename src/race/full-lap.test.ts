// End-to-end: a simple pure-pursuit autopilot drives each shipped lap through the real physics and the
// real lap loop, start to finish. Proves the shipped track is completable as a lap.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dot, FixedStepper, forwardOf, NO_INPUT, TICK_HZ, trackSurface, type CarInput } from '../physics'
import { exitPose, poses, type Pose, type Segment, type Track } from '../track/schema'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as Track

// Lap-time window per track (ms) for this conservative autopilot. A human drives ~0.67x the
// autopilot's time (operator's first lap2 run: 36.05 s vs 53.7 s), so lap2's 67-90 s window is a
// ~45-60 s human lap; the floor also catches the track being shortened again.
const HUMAN_PACE = 0.67
const CASES = [
  { track: load('lap1'), minMs: 10_000, maxMs: 90_000 },
  { track: load('lap2'), minMs: 45_000 / HUMAN_PACE, maxMs: 60_000 / HUMAN_PACE },
]

interface Sample {
  pose: Pose
  speed: number // target m/s
}

// Partial segment: the first `f` of it, so arcs and straights can be sampled densely.
function partial(seg: Segment, f: number): Segment {
  switch (seg.type) {
    case 'straight':
      return { ...seg, length: seg.length * f }
    case 'ramp':
      return { ...seg, length: seg.length * f, rise: seg.rise * f }
    case 'drop':
      return { ...seg, length: seg.length * f, fall: seg.fall * f }
    case 'hairpin':
      return { type: 'curve', turn: seg.turn, radius: seg.radius, angle: (180 * f) as 90 }
    case 'curve':
    case 'banked':
      return { ...seg, angle: (seg.angle * f) as 90 }
  }
}

const TARGET_SPEED: Record<Segment['type'], number> = {
  straight: 26,
  ramp: 16,
  drop: 16,
  hairpin: 11,
  curve: 13,
  banked: 14,
}

function centreline(track: Track): Sample[] {
  const entries = poses(track)
  const out: Sample[] = []
  track.segments.forEach((seg, i) => {
    // Slow down for the next segment before reaching it.
    const next = track.segments[(i + 1) % track.segments.length]
    for (let k = 0; k < 20; k++) {
      const f = k / 20
      const speed = f > 0.6 ? Math.min(TARGET_SPEED[seg.type], TARGET_SPEED[next.type]) : TARGET_SPEED[seg.type]
      out.push({ pose: exitPose(entries[i], partial(seg, f)), speed })
    }
  })
  return out
}

function autopilot(samples: Sample[]) {
  let index = 0
  return (state: FixedStepper['state']): CarInput => {
    const p = state.position
    const d2 = (s: Sample) => (s.pose.x - p.x) ** 2 + (s.pose.z - p.z) ** 2
    // Track progress monotonically: only look a short way ahead of the last match.
    for (let k = 1; k <= 15; k++) {
      const j = (index + k) % samples.length
      if (d2(samples[j]) < d2(samples[index])) index = j
    }
    const target = samples[(index + 4) % samples.length]
    const f = forwardOf(state)
    const dx = target.pose.x - p.x
    const dz = target.pose.z - p.z
    // Positive steer = right = toward -x (the car's local +x is its left).
    const angle = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz)
    const speed = dot(state.velocity, f)
    const want = samples[index].speed
    return {
      throttle: speed < want ? 1 : 0,
      brake: speed > want + 2 ? 1 : 0,
      steer: Math.max(-1, Math.min(1, 2.5 * angle)),
      handbrake: false,
    }
  }
}

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
})
