// The three standard corner radii (CORNER_RADII) are three driving styles, measured on the 14 m road:
// the autopilot holds a 90° corner of each radius at a fixed speed on grip alone, and the highest
// speed it holds without leaving the road, sliding (> 10°) or scrubbing (> 2.5 m/s) is that radius's
// grip limit. Each size is ≥ 15% faster than the next tighter one, and medium's limit is just under
// 90 km/h, so a 90 km/h entry needs the speed drift. On test-flat the medium corner proves both
// halves: flat out on grip alone a 90 km/h car runs off, and with a Space tap it drifts through
// (the drift retune of #103 for this corner; medium-drift.test.ts proves it on a lone r 40 corner).
import { describe, expect, it } from 'vitest'
import { createCarAt, dot, forwardOf, materialUnder, NO_INPUT, slipAngleDeg, step, TICK_HZ, trackSurface, type CarState, type Surface } from '../physics'
import { CORNER_RADII, CORNER_SIZES, partialPose, poses, segmentLength, type Pose, type Track } from '../track/schema'
import { autopilot, centreline, loadTrack, type Sample } from './autopilot.test-driver'

// The autopilot's line along every segment at one fixed speed.
const line = (track: Track, speed: number): Sample[] => {
  const entries = poses(track)
  return track.segments.flatMap((seg, i) => Array.from({ length: 200 }, (_, k) => ({ pose: partialPose(entries[i], seg, k / 200), speed })))
}

const near = (s: CarState, p: Pose, d: number) => Math.hypot(s.position.x - p.x, s.position.z - p.z) < d

/** Holds the corner from `entry` to `exit` at `v` m/s on grip alone. */
function holds(track: Track, surface: Surface, entry: Pose, exit: Pose, v: number): boolean {
  const drive = autopilot(line(track, v), 0.3)
  let s: CarState = createCarAt(poses(track)[0])
  let inCorner = false
  for (let t = 0; t < (700 / v + 30) * TICK_HZ; t++) {
    s = step(s, drive(s), surface)
    if (near(s, entry, 3)) inCorner = true
    if (!inCorner) continue
    if (materialUnder(s, surface) === 'offroad' || slipAngleDeg(s) > 10 || dot(s.velocity, forwardOf(s)) < v - 2.5) return false
    if (near(s, exit, 5)) return true
  }
  return false
}

/** Grip-limited speed (m/s, to 0.25) through a 90° right curve of `radius` after a 400 m run-in. */
function gripLimit(radius: number): number {
  const track: Track = {
    name: 'corner',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [
      { type: 'straight', length: 400 },
      { type: 'curve', turn: 'right', radius, angle: 90 },
      { type: 'straight', length: 150 },
    ],
    gates: [],
  }
  // No edge rails: the measurement is where grip lets go, so the car must be free to leave the road.
  const surface = trackSurface(track, { rails: false })
  const [, entry, exit] = poses(track)
  let lo = 6
  let hi = 41
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2
    if (holds(track, surface, entry, exit, mid)) lo = mid
    else hi = mid
  }
  return lo
}

describe('standard corner radii', () => {
  const limit = Object.fromEntries(CORNER_SIZES.map((size) => [size, gripLimit(CORNER_RADII[size])])) as Record<(typeof CORNER_SIZES)[number], number>

  it('each size is a different driving style: ≥ 15% faster than the next tighter one', () => {
    expect(limit.medium).toBeGreaterThan(1.15 * limit.tight)
    expect(limit.wide).toBeGreaterThan(1.15 * limit.medium)
  })

  it('medium is the 90 km/h drift corner: its grip limit is 22.5–24.9 m/s, just under 90 km/h', () => {
    expect(limit.medium).toBeGreaterThan(22.5)
    expect(limit.medium).toBeLessThan(24.9)
  })

  it('wide is flat out: its grip limit is within 3 m/s of top speed (40 m/s)', () => {
    expect(limit.wide).toBeGreaterThan(37)
  })
})

// test-flat's medium S: a right then a left, r 40 m 90°, on the back straight (segments 7–9).
// Keyboard-style driver as in medium-drift.test.ts: hold ENTRY on the back straight, then at the
// corner entry either a Space tap with full right lock or nothing; after that steer the velocity at
// the line 14 m ahead and countersteer slip above 8°. `lift` eases to about the corner's grip speed
// after the entry; without it the throttle holds ENTRY through the corner. The pair that proves the
// drift corner is flat out at 90 km/h: on grip alone the car runs off, with the tap it stays on.
describe('test-flat medium corner at 90 km/h', () => {
  const ENTRY = 25.5 // m/s, 92 km/h: inside the 25–26 window
  const track = loadTrack('test-flat')
  // No edge rails: both runs ask whether the car's own line stays on the road (AGENTS.md, rails).
  const surface = trackSurface(track, { rails: false })
  const p = poses(track)
  const corner = track.segments.findIndex((s) => s.type === 'curve' && s.radius === CORNER_RADII.medium)
  const line = centreline(track).map((x) => x.pose)
  const speedOf = (s: CarState) => Math.hypot(s.velocity.x, s.velocity.z)
  // 10 m into the straight after the corner: where the exit heading is read, once the slide has unwound.
  const after = partialPose(p[corner + 1], track.segments[corner + 1], 10 / segmentLength(track.segments[corner + 1]))

  function run(tap: number, lift: boolean) {
    const cornerSpeed = lift ? Math.min(ENTRY, Math.sqrt(14 * CORNER_RADII.medium)) : ENTRY
    let nearest = line.findIndex((q) => Math.hypot(q.x - p[corner - 1].x, q.z - p[corner - 1].z) < 1e-6)
    const steer = (s: CarState) => {
      const d2 = (k: number) => (line[k].x - s.position.x) ** 2 + (line[k].z - s.position.z) ** 2
      for (let k = nearest + 1; k < Math.min(line.length, nearest + 10); k++) if (d2(k) < d2(nearest)) nearest = k
      let ahead = nearest
      while (ahead < line.length - 1 && d2(ahead) < 14 ** 2) ahead++
      const dx = line[ahead].x - s.position.x
      const dz = line[ahead].z - s.position.z
      const aim = Math.atan2(s.velocity.x * dz - s.velocity.z * dx, s.velocity.x * dx + s.velocity.z * dz)
      const f = forwardOf(s)
      const slip = Math.sign(s.velocity.x * f.z - s.velocity.z * f.x) * Math.max(0, slipAngleDeg(s) - 8) * (Math.PI / 180)
      return Math.max(-1, Math.min(1, 3 * aim - 2 * slip))
    }
    let s: CarState = createCarAt(p[corner - 1])
    for (let t = 0; t < TICK_HZ; t++) s = step(s, NO_INPUT, surface)
    // The back straight runs -z: the corner entry is where z falls to the entry pose's z.
    while (s.position.z > p[corner].z) s = step(s, { ...NO_INPUT, steer: steer(s), throttle: speedOf(s) < ENTRY ? 1 : 0, brake: speedOf(s) > ENTRY + 1 ? 1 : 0 }, surface)
    const entry = speedOf(s)
    let maxSlip = 0
    let offroad = false
    let exitError = Infinity
    for (let t = 0; t < 10 * TICK_HZ && exitError === Infinity; t++) {
      const v = speedOf(s)
      const hb = t < tap * TICK_HZ
      s = step(s, hb ? { ...NO_INPUT, steer: 1, throttle: 1, handbrake: true } : { ...NO_INPUT, steer: steer(s), throttle: v < cornerSpeed ? 1 : 0, brake: v > cornerSpeed + 3 ? 1 : 0 }, surface)
      maxSlip = Math.max(maxSlip, slipAngleDeg(s))
      if (materialUnder(s, surface) === 'offroad') offroad = true
      if (near(s, after, 4)) {
        const travel = Math.atan2(s.velocity.x, s.velocity.z) - after.heading
        exitError = Math.abs(Math.atan2(Math.sin(travel), Math.cos(travel))) * (180 / Math.PI)
      }
    }
    return { entry, maxSlip, offroad, exitError }
  }

  it('enters at 25–26 m/s (90 km/h)', () => {
    const { entry } = run(0, false)
    expect(entry).toBeGreaterThan(25)
    expect(entry).toBeLessThan(26)
  })

  it('flat out on grip alone at 90 km/h the car runs off: the corner needs the drift', () => {
    expect(run(0, false).offroad).toBe(true)
  })

  it('the same flat-out car with a 0.25 s Space tap drifts through: slides 15–60°, stays on the road, exits within 15° of the straight', () => {
    const r = run(0.25, false)
    expect(r.maxSlip).toBeGreaterThan(15)
    expect(r.maxSlip).toBeLessThan(60)
    expect(r.offroad).toBe(false)
    expect(r.exitError).toBeLessThan(15)
  })

  it('a driver who eases to the corner speed drifts it with a 0.25–0.6 s tap the same way', () => {
    for (const tap of [0.25, 0.4, 0.6]) {
      const r = run(tap, true)
      expect(r.maxSlip, `tap ${tap}`).toBeGreaterThan(15)
      expect(r.maxSlip, `tap ${tap}`).toBeLessThan(60)
      expect(r.offroad, `tap ${tap}`).toBe(false)
      expect(r.exitError, `tap ${tap}`).toBeLessThan(15)
    }
  })
})
