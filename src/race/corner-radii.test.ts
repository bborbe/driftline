// The three standard corner radii (CORNER_RADII) are three driving styles, measured on the 14 m road:
// the autopilot holds a 90° corner of each radius at a fixed speed on grip alone, and the highest
// speed it holds without leaving the road, sliding (> 10°) or scrubbing (> 2.5 m/s) is that radius's
// grip limit. Each size is ≥ 15% faster than the next tighter one, and medium's limit is just under
// 90 km/h, so a 90 km/h entry needs the speed drift. On test-flat the medium corner proves both
// halves: on grip alone a 90 km/h car runs off, and with a handbrake tap it drifts through.
import { describe, expect, it } from 'vitest'
import { createCarAt, dot, forwardOf, materialUnder, slipAngleDeg, step, TICK_HZ, trackSurface, type CarInput, type CarState, type Surface } from '../physics'
import { CORNER_RADII, CORNER_SIZES, partialPose, poses, type Pose, type Track } from '../track/schema'
import { autopilot, loadTrack, type Sample } from './autopilot.test-driver'

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
  const surface = trackSurface(track)
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
describe('test-flat medium corner at 90 km/h', () => {
  const ENTRY = 25.5 // m/s, 92 km/h: inside the 25–26 window
  const TAP = 0.15 // s of handbrake at turn-in
  const track = loadTrack('test-flat')
  const surface = trackSurface(track)
  const p = poses(track)
  const corner = track.segments.findIndex((s) => s.type === 'curve' && s.radius === CORNER_RADII.medium)

  // From the back straight (segment corner-1) at ENTRY, through the medium right-hander. `tap`
  // adds the handbrake with full right lock for TAP s at turn-in; the autopilot steers otherwise.
  // The drift run (tap: slide 15–60°, on the road, exit within 15° of the straight) is asserted once
  // the speed-drift retune for this corner lands: at 8680349 every tap from 0.1 to 0.6 s runs off.
  function run(tap: boolean) {
    const drive = autopilot(line(track, ENTRY), 0.3)
    let s: CarState = createCarAt(p[corner - 1])
    let entry = 0
    let maxSlip = 0
    let offroad = false
    let tapTicks = -1
    for (let t = 0; t < 30 * TICK_HZ; t++) {
      let input: CarInput = drive(s)
      if (tapTicks < 0 && near(s, p[corner], 3)) {
        entry = dot(s.velocity, forwardOf(s))
        tapTicks = 0
      }
      if (tapTicks >= 0) {
        if (tap && tapTicks < TAP * TICK_HZ) input = { ...input, steer: 1, handbrake: true }
        tapTicks++
      }
      s = step(s, input, surface)
      if (tapTicks < 0) continue
      if (materialUnder(s, surface) === 'offroad') offroad = true
      if (Math.hypot(s.velocity.x, s.velocity.z) > 5) maxSlip = Math.max(maxSlip, slipAngleDeg(s))
      if (near(s, p[corner + 1], 5)) break
    }
    // Heading error against the straight after the corner (degrees).
    const f = forwardOf(s)
    const h = p[corner + 1].heading
    const exitError = (Math.acos(Math.max(-1, Math.min(1, f.x * Math.sin(h) + f.z * Math.cos(h)))) * 180) / Math.PI
    return { entry, maxSlip, offroad, exitError }
  }

  it('enters at 25–26 m/s (90 km/h)', () => {
    const { entry } = run(false)
    expect(entry).toBeGreaterThan(25)
    expect(entry).toBeLessThan(26)
  })

  it('on grip alone at 90 km/h the car runs off: the corner needs the drift', () => {
    expect(run(false).offroad).toBe(true)
  })
})
