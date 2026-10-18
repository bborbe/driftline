// Visual body feel: roll in corners, pitch under throttle/brake, squat on landing.
// Render-only — reads car state, never writes it. Pure TypeScript so it is unit-testable.
import { rotate, sub, dot, scale, v3, type Quat, type Vec3 } from '../../physics/vec'

const ROLL_PER_G = 0.07 // rad of body roll per g of lateral acceleration
const PITCH_PER_G = 0.05 // rad of pitch per g of longitudinal acceleration
const MAX_ROLL = 0.12
const MAX_PITCH = 0.08
const MAX_SQUAT = 0.18 // m
const LANDING_SPEED = 1 // m/s: falling faster than this when the fall is stopped counts as a landing
const G = 9.81
// Second-order spring toward the target; underdamped so the body settles with a small wobble.
const OMEGA = 14 // rad/s
const ZETA = 0.55

type Spring = { x: number; v: number }
export type BodyFeel = { roll: Spring; pitch: Spring; squat: Spring; lastVelocity: Vec3 | null }

export const createBodyFeel = (): BodyFeel => ({
  roll: { x: 0, v: 0 },
  pitch: { x: 0, v: 0 },
  squat: { x: 0, v: 0 },
  lastVelocity: null,
})

const clamp = (x: number, m: number) => Math.min(m, Math.max(-m, x))

const SUBSTEP = 1 / 240 // s: keeps the explicit spring stable on long frames

const spring = (s: Spring, target: number, dt: number): Spring => {
  let { x, v } = s
  for (let left = Math.min(dt, 0.1); left > 0; left -= SUBSTEP) {
    const h = Math.min(SUBSTEP, left)
    v += (OMEGA * OMEGA * (target - x) - 2 * ZETA * OMEGA * v) * h
    x += v * h
  }
  return { x, v }
}

/**
 * Advance the body springs one frame. Roll is about the car's forward axis (positive tilts the
 * roof toward -x, the right side), pitch about its lateral axis (positive dips the nose).
 */
export const updateBodyFeel = (b: BodyFeel, velocity: Vec3, orientation: Quat, dt: number): BodyFeel => {
  if (dt <= 0) return b
  if (!b.lastVelocity) return { ...b, lastVelocity: velocity }
  const acc = scale(sub(velocity, b.lastVelocity), 1 / dt)
  const fwd = rotate(orientation, v3(0, 0, 1))
  const left = rotate(orientation, v3(1, 0, 0))
  // The roof leans away from the turn: accel toward +x (left) tilts the roof right (positive roll).
  const roll = clamp((dot(acc, left) / G) * ROLL_PER_G, MAX_ROLL)
  const pitch = clamp((-dot(acc, fwd) / G) * PITCH_PER_G, MAX_PITCH)
  let squat = b.squat
  const lost = velocity.y - b.lastVelocity.y // positive when a fall is stopped
  // A landing spreads over a few frames as the springs catch the car, so every frame of it kicks.
  if (b.lastVelocity.y < -LANDING_SPEED && lost > 0.5) squat = { x: squat.x, v: Math.max(-4, squat.v - lost * 0.5) }
  squat = spring(squat, 0, dt)
  squat = { x: clamp(squat.x, MAX_SQUAT), v: squat.v }
  return { roll: spring(b.roll, roll, dt), pitch: spring(b.pitch, pitch, dt), squat, lastVelocity: velocity }
}

/**
 * How far (m, along body up) the lean and squat move the body at car-frame point (x, 0, z), as model.ts
 * applies them (Euler XYZ: pitch about x, then roll about z, then squat along up). A wheel's drawn spring
 * grows by this, so the wheel stays on the road while the body leans over it.
 */
export const bodyLift = (b: BodyFeel, x: number, z: number): number =>
  x * Math.sin(b.roll.x) * Math.cos(b.pitch.x) - z * Math.sin(b.pitch.x) + b.squat.x
