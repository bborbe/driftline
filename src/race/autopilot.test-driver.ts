// Pure-pursuit autopilot along a track's centreline, shared by the end-to-end lap tests
// (full-lap.test.ts, conservative `centreline` speeds) and the grass-cut test (cuts.test.ts,
// the faster `racingLine`).
import { readFileSync } from 'node:fs'
import { dot, forwardOf, type CarInput, type CarState } from '../physics'
import { resolveTrack } from '../track/kit'
import { partialPose, poses, type Pose, type Segment, type Track } from '../track/schema'

export const loadTrack = (name: string) =>
  resolveTrack(JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track

export interface Sample {
  pose: Pose
  speed: number // target m/s
}

const TARGET_SPEED: Record<Segment['type'], number> = {
  straight: 26,
  ramp: 16,
  drop: 16,
  hairpin: 11,
  curve: 13,
  banked: 14,
  gap: 26,
}

export function centreline(track: Track): Sample[] {
  const entries = poses(track)
  const out: Sample[] = []
  track.segments.forEach((seg, i) => {
    // Slow down for the next segment before reaching it.
    const next = track.segments[(i + 1) % track.segments.length]
    for (let k = 0; k < 20; k++) {
      const f = k / 20
      const speed = f > 0.6 ? Math.min(TARGET_SPEED[seg.type], TARGET_SPEED[next.type]) : TARGET_SPEED[seg.type]
      out.push({ pose: partialPose(entries[i], seg, f), speed })
    }
  })
  return out
}

// `lookahead` (s): aim that far ahead at the current speed; 0 = four samples ahead.
export function autopilot(samples: Sample[], lookahead = 0) {
  let index = 0
  return (state: CarState): CarInput => {
    const p = state.position
    const d2 = (s: Sample) => (s.pose.x - p.x) ** 2 + (s.pose.z - p.z) ** 2
    // Track progress monotonically: only look a short way ahead of the last match.
    for (let k = 1; k <= 15; k++) {
      const j = (index + k) % samples.length
      if (d2(samples[j]) < d2(samples[index])) index = j
    }
    const f = forwardOf(state)
    let ahead = (index + 4) % samples.length
    if (lookahead > 0) {
      // Aim a fixed time ahead (at least 6 m): a short fixed aim weaves at speed.
      const reach = Math.max(6, lookahead * dot(state.velocity, f)) ** 2
      for (let k = 1; k < samples.length && d2(samples[ahead]) < reach; k++) ahead = (index + k) % samples.length
    }
    const target = samples[ahead]
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

// Fast road line: the same centreline, with each piece's speed set by its corner radius
// (v = √(LATERAL · r)) and braked for in time (BRAKING), so it runs near the car's road pace.
// The baseline a grass cut has to beat (cuts.test.ts).
const LATERAL = 13 // m/s², sustained cornering on asphalt
const BRAKING = 11 // m/s², planned deceleration into a corner
const JUMP_SPEED = 18 // m/s on ramps and drops
const pieceLimit = (seg: Segment): number => {
  switch (seg.type) {
    case 'straight':
      return 40
    case 'ramp':
    case 'drop':
    case 'gap':
      return JUMP_SPEED
    default:
      return Math.sqrt(LATERAL * seg.radius)
  }
}

export function racingLine(track: Track): Sample[] {
  const entries = poses(track)
  const out: Sample[] = []
  track.segments.forEach((seg, i) => {
    for (let k = 0; k < 20; k++) out.push({ pose: partialPose(entries[i], seg, k / 20), speed: pieceLimit(seg) })
  })
  // Backward pass over two laps (the line wraps): never arrive faster than the next sample allows.
  for (let n = 2 * out.length - 1; n >= 0; n--) {
    const a = out[n % out.length]
    const b = out[(n + 1) % out.length]
    const d = Math.hypot(b.pose.x - a.pose.x, b.pose.z - a.pose.z)
    a.speed = Math.min(a.speed, Math.sqrt(b.speed ** 2 + 2 * BRAKING * d))
  }
  return out
}
