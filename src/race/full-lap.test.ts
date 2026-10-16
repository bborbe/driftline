// End-to-end: a simple pure-pursuit autopilot drives lap1 through the real physics and the
// real lap loop, start to finish. Proves the shipped track is completable as a lap.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dot, FixedStepper, forwardOf, NO_INPUT, TICK_HZ, trackSurface, wheelContacts, type CarInput } from '../physics'
import { exitPose, poses, type Pose, type Segment, type Track } from '../track/schema'
import { COUNTDOWN_TICKS, LapLoop } from './lap'

const lap1 = JSON.parse(readFileSync(new URL('../../assets/track/lap1.json', import.meta.url), 'utf8')) as Track

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

describe('lap1 end to end', () => {
  it('an autopilot completes a full lap: Begin, countdown, both checkpoints in order, finish', () => {
    const loop = new LapLoop(lap1, () => true)
    const sim = new FixedStepper(loop.spawn(), trackSurface(lap1))
    const drive = autopilot(centreline(lap1))
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
      sim.advance(1 / TICK_HZ, loop.input(raw))
      const respawned = loop.update(sim.state, wheelContacts(sim.state, sim.surface))
      if (respawned) sim.state = respawned
    }
    expect(events).toEqual(['start', 'cp1', 'cp2', 'finish'])
    expect(lapTime).toBeGreaterThan(10_000)
    expect(lapTime).toBeLessThan(90_000)
    console.log(`lap1 autopilot lap time: ${(lapTime / 1000).toFixed(2)} s`)
  })
})
