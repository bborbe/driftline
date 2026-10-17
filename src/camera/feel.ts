// Chase camera feel, free of three.js so it can be unit-tested: speed FOV, drift lean, look-ahead, impact shake,
// the start sweep and the finish orbit. Every effect scales with the Camera effects setting (Off / Low / Full);
// Off is the plain chase camera — constant FOV, no lean, no shake, no sweep, no orbit (accessibility).
import { add, length, scale, sub, v3, type Vec3 } from '../physics/vec'
import { MAX_SPEED } from '../physics/car'
import type { KeyValueStore } from '../race/store'
import { FOV_REST } from './chase'

export const CAMERA_FX = ['off', 'low', 'full'] as const
export type CameraFx = (typeof CAMERA_FX)[number]
export const CAMERA_FX_KEY = 'driftline.camera-fx'
/** Window event the settings panel fires when Camera effects changes; detail is the CameraFx. */
export const CAMERA_FX_EVENT = 'driftline:camera-fx'
const SCALE: Record<CameraFx, number> = { off: 0, low: 0.5, full: 1 }

/** Effect strength 0..1 for a setting. */
export const fxScale = (fx: CameraFx): number => SCALE[fx]

export const loadCameraFx = (store: KeyValueStore): CameraFx => {
  const v = store.getItem(CAMERA_FX_KEY)
  return (CAMERA_FX as readonly string[]).includes(v ?? '') ? (v as CameraFx) : 'full'
}

export const saveCameraFx = (store: KeyValueStore, fx: CameraFx): void => store.setItem(CAMERA_FX_KEY, fx)

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

// FOV: 70° at rest, widening with speed to FOV_REST + FOV_BOOST at top speed. The ease keeps town speeds near rest.
export { FOV_REST }
export const FOV_BOOST = 12
export const fovFor = (speed: number, k: number): number => FOV_REST + FOV_BOOST * k * clamp01(Math.abs(speed) / MAX_SPEED) ** 1.4

/** Signed body slip on the ground plane in degrees: nose angle minus travel angle (+ = nose left of travel). */
export const signedSlipDeg = (forward: Vec3, velocity: Vec3): number => {
  if (Math.hypot(velocity.x, velocity.z) < 3) return 0
  let d = Math.atan2(forward.x, forward.z) - Math.atan2(velocity.x, velocity.z)
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return (d * 180) / Math.PI
}

// Drift lean: camera roll, none in grip cornering (under LEAN_FROM degrees of slip), full LEAN_MAX_DEG by LEAN_FULL.
export const LEAN_MAX_DEG = 4
const LEAN_FROM = 6
const LEAN_FULL = 30
/** Target camera roll in degrees for a body slip (signed like signedSlipDeg). */
export const leanFor = (slipDeg: number, k: number): number =>
  Math.sign(slipDeg) * LEAN_MAX_DEG * k * smooth((Math.abs(slipDeg) - LEAN_FROM) / (LEAN_FULL - LEAN_FROM)) + 0 // never -0

// Look-ahead: the look target leads the car into a corner along its side axis, by yaw rate x speed, capped.
export const LOOK_AHEAD_MAX = 2
const LOOK_GAIN = 0.06 // m per (rad/s · m/s)
/** Sideways look offset in metres (+ = toward the turn's inside for a + yaw rate), for yaw rate (rad/s) and speed (m/s). */
export const lookAheadFor = (yawRate: number, speed: number, k: number): number => {
  const cap = LOOK_AHEAD_MAX * k
  return Math.max(-cap, Math.min(cap, LOOK_GAIN * yawRate * Math.abs(speed) * k))
}

/** Exponential approach of `from` to `to` at `rate` (1/s) over `dt`. */
export const damp = (from: number, to: number, rate: number, dt: number): number => from + (to - from) * (1 - Math.exp(-rate * dt))

// Shake: a hard landing (falling faster than LANDING_FROM m/s, stopped in one frame) or a big contact
// (horizontal speed lost faster than braking can) kicks an amplitude of up to SHAKE_MAX m that dies out in SHAKE_TIME s.
export const SHAKE_MAX = 0.15
export const SHAKE_TIME = 0.4
const LANDING_FROM = 4
const LANDING_FULL = 12
const CONTACT_FROM = 4 // m/s lost in one frame beyond braking
const CONTACT_FULL = 14
const BRAKE_DECEL = 20 // m/s², more than any brake or drag decel
const TELEPORT = 5 // m in one frame: a respawn or restart, not an impact

export type Shake = { amp: number; age: number }
export const NO_SHAKE: Shake = { amp: 0, age: SHAKE_TIME }

/** Impact strength 0..1 between two frames' car velocities (and positions, to ignore respawns). */
export const impactOf = (prevVel: Vec3, vel: Vec3, prevPos: Vec3, pos: Vec3, dt: number): number => {
  if (length(sub(pos, prevPos)) > TELEPORT) return 0
  const landing =
    prevVel.y < -LANDING_FROM && vel.y - prevVel.y > LANDING_FROM ? (-prevVel.y - LANDING_FROM) / (LANDING_FULL - LANDING_FROM) : -1
  const lost = Math.hypot(prevVel.x, prevVel.z) - Math.hypot(vel.x, vel.z) - BRAKE_DECEL * dt
  const contact = lost > CONTACT_FROM ? (lost - CONTACT_FROM) / (CONTACT_FULL - CONTACT_FROM) : -1
  const s = Math.max(landing, contact)
  return s < 0 ? 0 : 0.35 + 0.65 * clamp01(s)
}

/** Current amplitude: quadratic fade to 0 at SHAKE_TIME. */
export const shakeAmp = (sh: Shake): number => (sh.age >= SHAKE_TIME ? 0 : sh.amp * (1 - sh.age / SHAKE_TIME) ** 2)

/** Advance the shake by `dt`; a new impact restarts it when it kicks harder than what is left. */
export const updateShake = (sh: Shake, impact: number, k: number, dt: number): Shake => {
  const aged = { amp: sh.amp, age: sh.age + dt }
  const kick = SHAKE_MAX * k * impact
  return kick > shakeAmp(aged) ? { amp: kick, age: 0 } : aged
}

/** Camera position offset for the shake at time `t` (s): fixed incommensurate sines, so it is deterministic. */
export const shakeOffset = (sh: Shake, t: number): Vec3 => {
  const a = shakeAmp(sh)
  if (a === 0) return v3()
  const n = a / 1.5 // |(1, 1, 0.5)|, so the offset never exceeds the amplitude
  return v3(n * Math.sin(t * 71), n * Math.sin(t * 89 + 1.3), n * 0.5 * Math.sin(t * 53 + 2.1))
}

// Start sweep: across the countdown the camera swings from beside the car's nose round to the chase position,
// landing on it SWEEP_DONE s before GO.
export const SWEEP_DONE = 0.5
const SWEEP_FROM = 2.6 // rad round from behind
const SWEEP_RADIUS = 7
const SWEEP_HEIGHT = 1.4

/** Sweep progress 0..1 from the countdown time left (s) of a countdown `total` s long; 1 = on the chase pose. */
export const sweepProgress = (left: number, total: number): number => smooth((total - left) / (total - SWEEP_DONE))

/** Where the sweep camera sits at progress `p`; at p = 1 exactly `chase`. */
export const sweepPosition = (p: number, target: Vec3, forward: Vec3, chase: Vec3): Vec3 => {
  if (p >= 1) return chase
  const a = Math.atan2(-forward.x, -forward.z) + SWEEP_FROM * (1 - p) // 0 = straight behind the car
  const arc = add(target, v3(SWEEP_RADIUS * Math.sin(a), SWEEP_HEIGHT, SWEEP_RADIUS * Math.cos(a)))
  return add(arc, scale(sub(chase, arc), smooth(p * 1.25 - 0.25)))
}

// Finish orbit: after the line the camera circles the stopped car, eased in from where the chase camera was.
export const FINISH_ORBIT_RATE = 0.45 // rad/s
const ORBIT_RADIUS = 6.5
const ORBIT_HEIGHT = 2.2
const ORBIT_BLEND = 0.8 // s

/** Orbit camera `t` s after the finish, starting from `from` (the chase position at the line). */
export const finishOrbitPosition = (t: number, target: Vec3, from: Vec3): Vec3 => {
  const a = Math.atan2(from.x - target.x, from.z - target.z) + FINISH_ORBIT_RATE * t
  const ring = add(target, v3(ORBIT_RADIUS * Math.sin(a), ORBIT_HEIGHT, ORBIT_RADIUS * Math.cos(a)))
  return add(from, scale(sub(ring, from), smooth(t / ORBIT_BLEND)))
}
