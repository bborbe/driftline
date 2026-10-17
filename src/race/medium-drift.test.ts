// Speed drift through a medium corner (r 40 m, 90°) at 90 km/h, the drift corner of SC4 row 2:
// grip alone holds it to about 85-90 km/h, a Space tap with full steer at the entry carries the car
// round at speed. At 8680349 a tap of 0.25 s or longer snapped to 42°, slid 2.5 s and cut the
// infield down to 30 km/h. The 15 m hairpin is a brake corner: brake, then drift it deep.
import { describe, expect, it } from 'vitest'
import { createCarAt, forwardOf, materialUnder, NO_INPUT, slipAngleDeg, step, TICK_HZ, trackSurface, type CarState } from '../physics'
import { resolveTrack } from '../track/kit'
import { poses, type Track } from '../track/schema'
import { centreline } from './autopilot.test-driver'

const RUN_IN = 200
const corner = (radius: number, angle: number) =>
  resolveTrack({
    name: 'drift-corner',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [
      { type: 'straight', length: RUN_IN },
      { type: 'curve', turn: 'right', radius, angle },
      { type: 'straight', length: 150 },
    ],
    gates: [],
    zones: [],
  }) as Track

const speedOf = (s: CarState) => Math.hypot(s.velocity.x, s.velocity.z)

// Keyboard-style driver: Space with full right steer for `hold` s from `into` m past the corner entry,
// otherwise steer the velocity at the line 14 m ahead and catch slip above 8° with countersteer.
// Holds `entry` m/s on the run-in, then about the corner's grip speed.
function drive(radius: number, angle: number, hold: number, into: number, entry: number) {
  const cornerSpeed = Math.min(entry, Math.sqrt(14 * radius))
  const track = corner(radius, angle)
  const surface = trackSurface(track)
  const line = centreline(track).map((p) => p.pose)
  const exitHeading = poses(track)[2].heading
  let near = 0
  const steer = (s: CarState) => {
    const d2 = (k: number) => (line[k].x - s.position.x) ** 2 + (line[k].z - s.position.z) ** 2
    for (let k = near + 1; k < Math.min(line.length, near + 10); k++) if (d2(k) < d2(near)) near = k
    let ahead = near
    while (ahead < line.length - 1 && d2(ahead) < 14 ** 2) ahead++
    const dx = line[ahead].x - s.position.x
    const dz = line[ahead].z - s.position.z
    const aim = Math.atan2(s.velocity.x * dz - s.velocity.z * dx, s.velocity.x * dx + s.velocity.z * dz)
    const f = forwardOf(s)
    const slip = Math.sign(s.velocity.x * f.z - s.velocity.z * f.x) * Math.max(0, slipAngleDeg(s) - 8) * (Math.PI / 180)
    return Math.max(-1, Math.min(1, 3 * aim - 2 * slip))
  }
  let s: CarState = createCarAt(poses(track)[0])
  for (let t = 0; t < TICK_HZ; t++) s = step(s, NO_INPUT, surface)
  while (s.position.z < RUN_IN + into) s = step(s, { ...NO_INPUT, steer: steer(s), throttle: speedOf(s) < entry ? 1 : 0, brake: speedOf(s) > entry + 1 ? 1 : 0 }, surface)
  let maxSlip = 0
  let offroad = 0
  let minSpeed = speedOf(s)
  for (let t = 0; t < 10 * TICK_HZ && near < line.length - 15; t++) {
    const hb = t < hold * TICK_HZ
    const v = speedOf(s)
    s = step(s, hb ? { ...NO_INPUT, steer: 1, throttle: 1, handbrake: true } : { ...NO_INPUT, steer: steer(s), throttle: v < cornerSpeed ? 1 : 0, brake: v > cornerSpeed + 3 ? 1 : 0 }, surface)
    maxSlip = Math.max(maxSlip, slipAngleDeg(s))
    if (materialUnder(s, surface) !== 'road') offroad++
    minSpeed = Math.min(minSpeed, speedOf(s))
  }
  const travel = Math.atan2(s.velocity.x, s.velocity.z) - exitHeading
  const exitError = Math.abs(Math.atan2(Math.sin(travel), Math.cos(travel))) * (180 / Math.PI)
  return { maxSlip, offroad: offroad / TICK_HZ, minKmh: minSpeed * 3.6, exitError, exited: near >= line.length - 15 }
}

describe('speed drift through a medium corner', () => {
  it('a 0.25-0.6 s Space tap at the entry slides 15-60°, stays on the road, keeps 75 km/h and exits straight', () => {
    for (const hold of [0.25, 0.4, 0.6]) {
      for (const into of [0, 5]) {
        const r = drive(40, 90, hold, into, 25)
        expect(r.exited, `hold ${hold} into ${into}`).toBe(true)
        expect(r.maxSlip, `hold ${hold} into ${into}`).toBeGreaterThan(15)
        expect(r.maxSlip, `hold ${hold} into ${into}`).toBeLessThan(60)
        expect(r.offroad, `hold ${hold} into ${into}`).toBe(0)
        expect(r.minKmh, `hold ${hold} into ${into}`).toBeGreaterThan(75)
        expect(r.exitError, `hold ${hold} into ${into}`).toBeLessThan(15)
      }
    }
  })

  it('hold with steer: a tap at the entry, steer held into the turn to 75°, then straightened, stays on the road at speed', () => {
    for (const tap of [0.25, 0.4]) {
      for (const steer of [0.7, 1]) {
        const track = corner(40, 90)
        const surface = trackSurface(track)
        let s: CarState = createCarAt(poses(track)[0])
        for (let t = 0; t < TICK_HZ; t++) s = step(s, NO_INPUT, surface)
        while (s.position.z < RUN_IN) s = step(s, { ...NO_INPUT, throttle: speedOf(s) < 25 ? 1 : 0, steer: -0.1 * s.position.x }, surface)
        let offroad = 0
        let minSpeed = speedOf(s)
        let turned = 0
        for (let t = 0; t < 6 * TICK_HZ && !(turned >= 75 && slipAngleDeg(s) < 5); t++) {
          const f = forwardOf(s)
          turned = -Math.atan2(f.x, f.z) * (180 / Math.PI)
          const input = t < tap * TICK_HZ ? 1 : turned < 75 ? steer : 0
          s = step(s, { ...NO_INPUT, throttle: 1, steer: input, handbrake: t < tap * TICK_HZ }, surface)
          if (materialUnder(s, surface) !== 'road') offroad++
          minSpeed = Math.min(minSpeed, speedOf(s))
        }
        expect(turned, `tap ${tap} steer ${steer}`).toBeGreaterThan(75)
        expect(offroad, `tap ${tap} steer ${steer}`).toBe(0)
        expect(minSpeed * 3.6, `tap ${tap} steer ${steer}`).toBeGreaterThan(75)
      }
    }
  })

  it('the 15 m hairpin: braked to ~68 km/h, a held drift gets round on the road', () => {
    for (const hold of [0.4, 0.8]) {
      for (const into of [-5, 0]) {
        const r = drive(15, 180, hold, into, 19)
        expect(r.exited, `hold ${hold} into ${into}`).toBe(true)
        expect(r.offroad, `hold ${hold} into ${into}`).toBe(0)
      }
    }
  })
})
