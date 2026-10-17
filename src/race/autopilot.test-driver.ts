// Pure-pursuit autopilot along a track's centreline, shared by the end-to-end lap tests
// (full-lap.test.ts, conservative `centreline` speeds; the style tracks S01–S05 drive the
// surface-aware `surfaceLine`) and the grass-cut test (cuts.test.ts, the faster `racingLine`,
// surface-aware for the style tracks).
import { readFileSync } from 'node:fs'
import { dot, forwardOf, MATERIALS, rotate, type CarInput, type CarState, type Material } from '../physics'
import { resolveTrack } from '../track/kit'
import { partialPose, poses, segmentLength, type Pose, type Segment, type Track } from '../track/schema'

/** A human laps ~0.67x the conservative autopilot's time (operator's first lap2 run: 36.05 s vs 53.7 s). */
export const HUMAN_PACE = 0.67

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
  loop: 40, // full throttle round the loop: it needs speed, never braking
  wallride: 30, // the wall holds the car through the turn at speed
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

// Surface-aware variant of centreline() for the style tracks (S01–S05), whose tight kit corners
// (r 10 m) and dirt and ice corners the per-type pace above takes too fast: corners are capped at
// √(CORNER_LATERAL · grip · radius), and the line brakes in time at AUTO_BRAKING scaled by grip. The original tracks keep centreline(), so their laps and medals are unchanged.
const CORNER_LATERAL = 12.3 // m/s²
const AUTO_BRAKING = 8 // m/s² on asphalt
const SAMPLE_SPACING = 5 // m
const CORNER = new Set<Segment['type']>(['curve', 'hairpin', 'banked'])

/** Surface grip at fraction `f` of segment `i` (1 = asphalt): dirt, ice and grass zones lower it. */
const gripAt = (track: Track, i: number, f: number): number =>
  Math.min(
    1,
    ...(track.zones ?? []).filter((z) => z.segment === i && f >= z.from && f <= z.to && z.kind in MATERIALS).map((z) => MATERIALS[z.kind as Material].grip),
  )

/** Target speed at fraction `f` of segment `i`: its type's pace, capped in corners by grip and radius. */
const targetSpeed = (track: Track, i: number, f: number): number => {
  const seg = track.segments[i]
  const pace = TARGET_SPEED[seg.type]
  return CORNER.has(seg.type) && 'radius' in seg ? Math.min(pace, Math.sqrt(CORNER_LATERAL * gripAt(track, i, f) * seg.radius)) : pace
}

export function surfaceLine(track: Track): Sample[] {
  const entries = poses(track)
  const out: (Sample & { grip: number })[] = []
  track.segments.forEach((seg, i) => {
    const next = (i + 1) % track.segments.length
    // At least 20 samples, and one every SAMPLE_SPACING: on a long arc the pure-pursuit aim point
    // (four samples ahead) would otherwise cut the inside of the turn.
    const n = Math.max(20, Math.ceil(segmentLength(seg) / SAMPLE_SPACING))
    for (let k = 0; k < n; k++) {
      const f = k / n
      const speed = f > 0.6 ? Math.min(targetSpeed(track, i, f), targetSpeed(track, next, 0)) : targetSpeed(track, i, f)
      out.push({ pose: partialPose(entries[i], seg, f), speed, grip: gripAt(track, i, f) })
    }
  })
  // Brake in time: never arrive faster than the next sample allows at AUTO_BRAKING scaled by the
  // surface's grip, which is weak on dirt and ice (two passes: the line wraps).
  for (let n = 2 * out.length - 1; n >= 0; n--) {
    const a = out[n % out.length]
    const b = out[(n + 1) % out.length]
    const d = Math.hypot(b.pose.x - a.pose.x, b.pose.z - a.pose.z)
    a.speed = Math.min(a.speed, Math.sqrt(b.speed ** 2 + 2 * AUTO_BRAKING * a.grip * d))
  }
  return out
}

// `lookahead` (s): aim that far ahead at the current speed; 0 = four samples ahead.
// `loops` (a track with a loop): where the road runs back over itself, track progress by distance in
// 3D and aim in the car's own frame, which still holds upside down. Off by default, so the laps of
// every track without a loop are unchanged.
export function autopilot(samples: Sample[], lookahead = 0, loops = false) {
  let index = 0
  return (state: CarState): CarInput => {
    const p = state.position
    const d2 = loops
      ? (s: Sample) => (s.pose.x - p.x) ** 2 + (s.pose.y - p.y) ** 2 + (s.pose.z - p.z) ** 2
      : (s: Sample) => (s.pose.x - p.x) ** 2 + (s.pose.z - p.z) ** 2
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
    const angle = loops ? bodyAngle(state, target.pose) : Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz)
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

// Angle to `target` in the car's own frame (+ = to its right, like `angle` above), any way up.
const bodyAngle = (s: CarState, target: Pose): number => {
  const q = s.orientation
  const l = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, { x: target.x - s.position.x, y: target.y - s.position.y, z: target.z - s.position.z })
  return Math.atan2(-l.x, l.z)
}

/** True when the track has a loop: drive it with autopilot(…, …, true). */
export const hasLoop = (track: Track): boolean => track.segments.some((seg) => seg.type === 'loop')

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
    case 'loop':
      return 40
    default:
      return Math.sqrt(LATERAL * seg.radius)
  }
}

// A corner's speed limit scales with √grip (v = √(LATERAL · grip · r)); straights keep theirs.
const cornerGrip = (seg: Segment, grip: number): number => (CORNER.has(seg.type) ? Math.sqrt(grip) : 1)

// `surfaceAware` (the style tracks S01–S05): corner limits and braking scale with the surface's
// grip, so the line stays on dirt and ice. Off by default, so the original tracks' cut baselines
// are unchanged.
export function racingLine(track: Track, surfaceAware = false): Sample[] {
  const entries = poses(track)
  const out: (Sample & { grip: number })[] = []
  track.segments.forEach((seg, i) => {
    // Surface-aware lines also sample every SAMPLE_SPACING, like surfaceLine(), for the long r 80 m banks.
    const n = surfaceAware ? Math.max(20, Math.ceil(segmentLength(seg) / SAMPLE_SPACING)) : 20
    for (let k = 0; k < n; k++) {
      const grip = surfaceAware ? gripAt(track, i, k / n) : 1
      out.push({ pose: partialPose(entries[i], seg, k / n), speed: pieceLimit(seg) * cornerGrip(seg, grip), grip })
    }
  })
  // Backward pass over two laps (the line wraps): never arrive faster than the next sample allows.
  for (let n = 2 * out.length - 1; n >= 0; n--) {
    const a = out[n % out.length]
    const b = out[(n + 1) % out.length]
    const d = Math.hypot(b.pose.x - a.pose.x, b.pose.z - a.pose.z)
    a.speed = Math.min(a.speed, Math.sqrt(b.speed ** 2 + 2 * BRAKING * a.grip * d))
  }
  return out
}
