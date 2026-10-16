// Raycast-wheel car on a drivable Surface (default: flat y = 0 plane), stepped at a fixed 100 Hz.
// Pure and deterministic: no three.js, no clocks, no randomness.
import {
  add, cross, dot, integrateQuat, length, normalize, quatIdentity, quatNormalize, rotate, scale, sub, v3,
  type Quat, type Vec3,
} from './vec'
import type { Pillar } from '../track/schema'
import { FLAT, type Material, type RayHit, type Surface } from './surface'

export const TICK_HZ = 100
export const DT = 1 / TICK_HZ
export const MAX_SPEED = 40 // m/s
export const MAX_REVERSE_SPEED = 10 // m/s

export type CarInput = {
  throttle: number // 0..1
  brake: number // 0..1 — brakes when moving forward, reverses once stopped
  steer: number // -1 (left) .. 1 (right)
  handbrake: boolean
}

export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false }

export type CarState = {
  position: Vec3
  velocity: Vec3
  orientation: Quat
  angularVelocity: Vec3 // world frame
  steerAngle: number // rad, smoothed
  tick: number
  turbo: number // ticks of turbo boost left (0 = none)
  turboForce: number // N, forward push while turbo > 0
}

const GRAVITY = 9.81
const MASS = 1200
// Box inertia for ~1.8 x 1.2 x 4.2 m body.
const INERTIA = v3(
  (MASS / 12) * (1.2 ** 2 + 4.2 ** 2),
  (MASS / 12) * (1.8 ** 2 + 4.2 ** 2),
  (MASS / 12) * (1.8 ** 2 + 1.2 ** 2),
)
const REST_LENGTH = 0.5
const SPRING = 40000
const DAMPER = 4500
const WHEEL_RADIUS = 0.35
// Wheel rays start this far above the spring mount (about the chassis top), so a mount that
// has sunk through the surface on a hard landing still finds it and the spring pushes back.
const RAY_LIFT = 1.0
// Compression cap: bounds the spring force when the car is pressed deep into a surface.
const MAX_COMPRESSION = REST_LENGTH + RAY_LIFT
// Floor for dot(body-up, surface normal) in the compression rate (car tilted < ~72°).
const MIN_UP_DOT = 0.3
const GRIP = 1.6 // front friction coefficient (arcade)
const REAR_GRIP = 2.0 // rear grips more than front: stable, understeer-leaning balance
// Traction control: drive force on a rear wheel is capped to this share of its grip,
// so full throttle still leaves lateral grip (power oversteer otherwise spins the car).
const DRIVE_SHARE = 0.75
const HANDBRAKE_REAR_GRIP = 0.3 // fraction of rear lateral grip kept on handbrake
const PEAK_SLIP = 0.15 // rad — softer slip curve, grip builds more gradually
const ENGINE_FORCE = 9000 // N, rear-wheel drive total
const BRAKE_FORCE = 16000 // N, all wheels total
const REVERSE_FORCE = 6000 // N, rear-wheel drive total
const STOPPED = 0.5 // m/s — below this, brake input becomes reverse and throttle drives forward
const HANDBRAKE_FORCE = 3000 // N, rear wheels total
const MAX_STEER = 0.5 // rad
const STEER_RATE = 4 // rad/s
const DRAG = 0.45
const ROLLING = 30
// Off-throttle coast-down (rolling resistance + drivetrain drag), as a fraction of wheel load.
const COAST_RESISTANCE = 0.3

// Per-material handling. `grip` scales the tyre friction coefficient; `drag` is extra rolling
// resistance as a fraction of wheel load, always on (grass and dirt bog the car down).
// `maxSpeed` (m/s, default MAX_SPEED) caps what the engine drives a wheel to on that material;
// above it the wheel is braked by OVERSPEED_DRAG, so diving onto it at speed bleeds speed fast.
export type MaterialHandling = { grip: number; drag: number; maxSpeed?: number }
export const MATERIALS: Readonly<Record<Material, MaterialHandling>> = {
  road: { grip: 1, drag: 0 },
  'turbo': { grip: 1, drag: 0 },
  'turbo-red': { grip: 1, drag: 0 },
  dirt: { grip: 0.6, drag: 0.04 },
  ice: { grip: 0.18, drag: 0 },
  grass: { grip: 0.5, drag: 0.12 },
  // Off-track ground, Trackmania-style: cutting across the field never beats the road.
  offroad: { grip: 0.45, drag: 0.1, maxSpeed: 10 },
}
// Resistance (fraction of wheel load) once a wheel is OVERSPEED_RAMP m/s or more over its material's maxSpeed.
const OVERSPEED_DRAG = 1.5
const OVERSPEED_RAMP = 3 // m/s

// Turbo pads, Trackmania-style: touching one starts (or refreshes) a fixed-time forward push.
export const TURBO = {
  'turbo': { ticks: 1.0 * TICK_HZ, force: 7000 },
  'turbo-red': { ticks: 1.5 * TICK_HZ, force: 14000 },
} as const

// Local frame: +z forward, +y up, so +x is the driver's LEFT (right = forward × up = -x). Mount points sit at the top of each spring.
type Wheel = { mount: Vec3; front: boolean }
const WHEELS: Wheel[] = [
  { mount: v3(-0.8, 0, 1.3), front: true },
  { mount: v3(0.8, 0, 1.3), front: true },
  { mount: v3(-0.8, 0, -1.3), front: false },
  { mount: v3(0.8, 0, -1.3), front: false },
]

// Body height above the surface when spawned; the springs settle it from there.
const SPAWN_HEIGHT = REST_LENGTH + WHEEL_RADIUS - 0.15

export const createCar = (position: Vec3 = v3(0, SPAWN_HEIGHT, 0)): CarState => ({
  position,
  velocity: v3(),
  orientation: quatIdentity(),
  angularVelocity: v3(),
  steerAngle: 0,
  tick: 0,
  turbo: 0,
  turboForce: 0,
})

/** Car at rest on a track pose, facing its heading (0 = +z). */
export const createCarAt = (pose: { x: number; y: number; z: number; heading: number }): CarState => {
  const half = pose.heading / 2
  return {
    ...createCar(v3(pose.x, pose.y + SPAWN_HEIGHT, pose.z)),
    orientation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
  }
}

export const forwardOf = (s: CarState): Vec3 => rotate(s.orientation, v3(0, 0, 1))

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

// Applies a world-frame inverse inertia approximation: rotate torque into the body frame,
// divide by the principal moments, rotate back.
const angularAccel = (q: Quat, torque: Vec3): Vec3 => {
  const inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w }
  const local = rotate(inv, torque)
  return rotate(q, v3(local.x / INERTIA.x, local.y / INERTIA.y, local.z / INERTIA.z))
}

// Body footprint against obstacles: a capsule along the car's forward axis (segment ±BODY_REACH,
// radius BODY_RADIUS), matching the ~1.8 x 4.2 m body. At MAX_SPEED the car moves 0.4 m a tick,
// well under the thinnest pillar plus the radius, so it cannot tunnel through.
const BODY_RADIUS = 0.9
const BODY_REACH = 1.2
const BODY_SAMPLES = 7
// Fraction of the into-wall speed kept as a bounce, and of the along-wall speed kept as a scrape.
const WALL_BOUNCE = 0.2
const WALL_SCRAPE = 0.7

type Moved = { position: Vec3; velocity: Vec3 }

// Push the body out of every pillar it overlaps (in the horizontal plane) and kill its speed
// into the pillar: a wall hit, Trackmania-style.
const collide = (position: Vec3, velocity: Vec3, fwd: Vec3, obstacles: readonly Pillar[] | undefined): Moved => {
  if (!obstacles || obstacles.length === 0) return { position, velocity }
  const flat = Math.hypot(fwd.x, fwd.z)
  const fx = flat > 1e-6 ? fwd.x / flat : 0
  const fz = flat > 1e-6 ? fwd.z / flat : 1
  let pos = position
  let vel = velocity
  for (const o of obstacles) {
    if (pos.y < o.y - 1 || pos.y > o.y + o.height) continue
    const reach = o.halfWidth + o.halfDepth + BODY_REACH + BODY_RADIUS
    if (Math.abs(pos.x - o.x) > reach || Math.abs(pos.z - o.z) > reach) continue
    // Deepest overlap among points along the body axis, in the pillar's frame (u along, w across).
    const ou = { x: Math.sin(o.heading), z: Math.cos(o.heading) }
    let best: { depth: number; nx: number; nz: number } | null = null
    for (let i = 0; i < BODY_SAMPLES; i++) {
      const t = (2 * i) / (BODY_SAMPLES - 1) - 1
      const px = pos.x + fx * BODY_REACH * t - o.x
      const pz = pos.z + fz * BODY_REACH * t - o.z
      const u = px * ou.x + pz * ou.z
      const w = px * ou.z - pz * ou.x
      const cu = clamp(u, -o.halfDepth, o.halfDepth)
      const cw = clamp(w, -o.halfWidth, o.halfWidth)
      let du = u - cu
      let dw = w - cw
      let d = Math.hypot(du, dw)
      let depth: number
      if (d > 1e-9) {
        depth = BODY_RADIUS - d
        du /= d
        dw /= d
      } else {
        // Sample point inside the box: leave by the nearest face.
        const eu = o.halfDepth - Math.abs(u)
        const ew = o.halfWidth - Math.abs(w)
        if (eu < ew) {
          du = Math.sign(u) || 1
          dw = 0
          d = eu
        } else {
          du = 0
          dw = Math.sign(w) || 1
          d = ew
        }
        depth = BODY_RADIUS + d
      }
      if (depth > 0 && (!best || depth > best.depth)) {
        best = { depth, nx: du * ou.x + dw * ou.z, nz: du * ou.z - dw * ou.x }
      }
    }
    if (!best) continue
    pos = v3(pos.x + best.nx * best.depth, pos.y, pos.z + best.nz * best.depth)
    const vn = vel.x * best.nx + vel.z * best.nz
    if (vn < 0) {
      const tx = vel.x - vn * best.nx
      const tz = vel.z - vn * best.nz
      vel = v3(tx * WALL_SCRAPE - WALL_BOUNCE * vn * best.nx, vel.y, tz * WALL_SCRAPE - WALL_BOUNCE * vn * best.nz)
    }
  }
  return { position: pos, velocity: vel }
}

export const step = (s: CarState, input: CarInput, surface: Surface = FLAT): CarState => {
  const steerTarget = clamp(input.steer, -1, 1) * MAX_STEER * (1 - 0.5 * clamp(length(s.velocity) / MAX_SPEED, 0, 1))
  const steerDelta = clamp(steerTarget - s.steerAngle, -STEER_RATE * DT, STEER_RATE * DT)
  const steerAngle = s.steerAngle + steerDelta

  const up = rotate(s.orientation, v3(0, 1, 0))
  const fwdBody = rotate(s.orientation, v3(0, 0, 1))

  let force = v3(0, -GRAVITY * MASS, 0)
  let torque = v3()

  const speed = dot(s.velocity, fwdBody)
  const throttle = clamp(input.throttle, 0, 1)
  const brake = clamp(input.brake, 0, 1)
  // Trackmania-style pedals: S brakes until stopped, then reverses; W while rolling
  // backwards brakes first, then drives forward.
  const reversing = speed < -STOPPED
  const forwardDrive = reversing ? 0 : throttle
  const reverseDrive = speed < STOPPED ? brake : 0
  const brakeInput = (speed >= STOPPED ? brake : 0) + (reversing ? throttle : 0)
  const driveFalloff = clamp((MAX_SPEED + 2 - Math.abs(speed)) / 12, 0, 1)
  const reverseFalloff = clamp((MAX_REVERSE_SPEED + Math.min(speed, 0)) / 2, 0, 1)
  let turbo = Math.max(0, s.turbo - 1)
  let turboForce = turbo > 0 ? s.turboForce : 0
  let grounded = false

  for (const wheel of WHEELS) {
    const r = rotate(s.orientation, wheel.mount)
    const contact = wheelContact(add(s.position, r), up, surface)
    if (!contact) continue
    const { hit, compression } = contact
    grounded = true
    const material = hit.material ?? 'road'
    const handling = MATERIALS[material]
    if (material === 'turbo' || material === 'turbo-red') {
      // A stronger pad overrides a weaker running boost; the same pad refreshes it.
      const pad = TURBO[material]
      if (pad.force >= turboForce || turbo === 0) {
        turbo = pad.ticks
        turboForce = pad.force
      }
    }

    const contactVel = add(s.velocity, cross(s.angularVelocity, r))
    // Compression rate = rate the ray length shrinks against the surface. Measured along
    // the surface normal, not body-up: on a tilted landing the forward speed has a large
    // body-up component that would otherwise read as the spring extending and cancel it.
    const springVel = -dot(contactVel, hit.normal) / Math.max(dot(up, hit.normal), MIN_UP_DOT)
    const normalForce = Math.max(0, SPRING * compression + DAMPER * springVel)

    // Tire frame projected onto the contact plane.
    const wheelYaw = wheel.front ? steerAngle : 0
    // Positive steer = right = toward -x.
    const fwdLocal = v3(-Math.sin(wheelYaw), 0, Math.cos(wheelYaw))
    let fwd = rotate(s.orientation, fwdLocal)
    const n = hit.normal
    fwd = normalize(sub(fwd, scale(n, dot(fwd, n))))
    const right = cross(fwd, n)

    const vLong = dot(contactVel, fwd)
    const vLat = dot(contactVel, right)

    const maxFriction = (wheel.front ? GRIP : REAR_GRIP) * handling.grip * normalForce
    // Lateral: saturating slip-angle model.
    const slip = Math.atan2(vLat, Math.max(Math.abs(vLong), 1))
    let lateralGrip = maxFriction * Math.tanh(slip / PEAK_SLIP)
    if (!wheel.front && input.handbrake) lateralGrip *= HANDBRAKE_REAR_GRIP
    let fLat = -lateralGrip

    // Longitudinal: drive (rear), brake (all), handbrake (rear).
    let fLong = 0
    if (!wheel.front) {
      const capFalloff = handling.maxSpeed === undefined ? 1 : clamp((handling.maxSpeed + 2 - Math.abs(speed)) / 12, 0, 1)
      const drive = (forwardDrive * ENGINE_FORCE * Math.min(driveFalloff, capFalloff) - reverseDrive * REVERSE_FORCE * reverseFalloff) / 2
      const cap = DRIVE_SHARE * maxFriction
      fLong += clamp(drive, -cap, cap)
    }
    const brakeTotal = (brakeInput * BRAKE_FORCE) / 4 + (!wheel.front && input.handbrake ? HANDBRAKE_FORCE / 2 : 0)
    if (brakeTotal > 0) {
      // Never reverse the wheel: cap braking to what stops it this tick.
      const stopForce = (Math.abs(vLong) * MASS) / 4 / DT
      fLong -= Math.sign(vLong) * Math.min(brakeTotal, stopForce)
    }
    const coast = (forwardDrive <= 0 && reverseDrive <= 0 ? COAST_RESISTANCE * normalForce : 0) + handling.drag * normalForce
    fLong -= Math.sign(vLong) * Math.min(ROLLING / 4 + coast, (Math.abs(vLong) * MASS) / 4 / DT)

    // Friction circle.
    const total = Math.hypot(fLong, fLat)
    if (total > maxFriction && total > 0) {
      fLong *= maxFriction / total
      fLat *= maxFriction / total
    }

    // Over a material's maxSpeed the ground itself holds the wheel back (soft ground, not tyre
    // friction), so it acts outside the friction circle and leaves the lateral grip intact.
    if (handling.maxSpeed !== undefined) {
      const overspeed = clamp((Math.abs(vLong) - handling.maxSpeed) / OVERSPEED_RAMP, 0, 1)
      fLong -= Math.sign(vLong) * Math.min(OVERSPEED_DRAG * overspeed * normalForce, (Math.abs(vLong) * MASS) / 4 / DT)
    }

    const wheelForce = add(add(scale(up, normalForce), scale(fwd, fLong)), scale(right, fLat))
    force = add(force, wheelForce)
    torque = add(torque, cross(r, wheelForce))
  }

  // Turbo pushes along the body while on the ground, like a pad kick through the tyres.
  if (turbo > 0 && grounded) force = add(force, scale(fwdBody, turboForce))

  const v = length(s.velocity)
  force = sub(force, scale(s.velocity, DRAG * v))

  const velocity = add(s.velocity, scale(force, DT / MASS))
  const angAcc = angularAccel(s.orientation, torque)
  const angularVelocity = scale(add(s.angularVelocity, scale(angAcc, DT)), 0.999)
  const orientation = integrateQuat(s.orientation, angularVelocity, DT)
  const moved = collide(add(s.position, scale(velocity, DT)), velocity, fwdBody, surface.obstacles)

  return { ...moved, orientation, angularVelocity, steerAngle, tick: s.tick + 1, turbo, turboForce }
}

// Angle between heading and velocity on the ground plane, in degrees.
export const slipAngleDeg = (s: CarState): number => {
  const vel = v3(s.velocity.x, 0, s.velocity.z)
  if (length(vel) < 0.5) return 0
  const fwd = forwardOf(s)
  const f = normalize(v3(fwd.x, 0, fwd.z))
  const c = clamp(dot(f, normalize(vel)), -1, 1)
  return (Math.acos(c) * 180) / Math.PI
}

// Fixed-timestep driver: consumes real elapsed time, runs whole ticks only.
export class FixedStepper {
  private accumulator = 0
  state: CarState

  readonly surface: Surface

  constructor(state: CarState, surface: Surface = FLAT) {
    this.state = state
    this.surface = surface
  }

  advance(elapsedSeconds: number, input: CarInput): number {
    this.accumulator += Math.min(elapsedSeconds, 0.25)
    let ticks = 0
    while (this.accumulator >= DT) {
      this.previous = this.state
      this.state = step(this.state, input, this.surface)
      this.stepped = this.state
      this.accumulator -= DT
      ticks++
    }
    return ticks
  }

  // State to draw: blended between the last two ticks by the leftover accumulator, so a
  // display rate that is not a multiple of 100 Hz moves the car evenly every frame.
  // Snaps to `state` when it was replaced outside advance() (spawn, respawn, restart).
  render(): CarState {
    if (this.previous === undefined || this.stepped !== this.state) return this.state
    return interpolate(this.previous, this.state, this.alpha)
  }

  // Fraction of a tick left in the accumulator, 0..1.
  get alpha(): number {
    return this.accumulator / DT
  }

  private previous: CarState | undefined
  private stepped: CarState | undefined
}

export const interpolate = (a: CarState, b: CarState, t: number): CarState => ({
  ...b,
  position: add(a.position, scale(sub(b.position, a.position), t)),
  orientation: nlerp(a.orientation, b.orientation, t),
  steerAngle: a.steerAngle + (b.steerAngle - a.steerAngle) * t,
})

const nlerp = (a: Quat, b: Quat, t: number): Quat => {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
  return quatNormalize({
    x: a.x + (sign * b.x - a.x) * t,
    y: a.y + (sign * b.y - a.y) * t,
    z: a.z + (sign * b.z - a.z) * t,
    w: a.w + (sign * b.w - a.w) * t,
  })
}

// Material under the car: the one most wheels stand on (ties go to the earlier wheel, front first);
// 'road' when airborne. Read by audio and effects, never by step().
export const materialUnder = (s: CarState, surface: Surface = FLAT): Material => {
  const up = rotate(s.orientation, v3(0, 1, 0))
  const counts = new Map<Material, number>()
  let best: Material = 'road'
  let bestN = 0
  for (const wheel of WHEELS) {
    const c = wheelContact(add(s.position, rotate(s.orientation, wheel.mount)), up, surface)
    if (!c) continue
    const m = c.hit.material ?? 'road'
    const n = (counts.get(m) ?? 0) + 1
    counts.set(m, n)
    if (n > bestN) {
      best = m
      bestN = n
    }
  }
  return best
}

// Number of wheels whose suspension ray reaches the surface (0 = airborne).
export const wheelContacts = (s: CarState, surface: Surface = FLAT): number => {
  const up = rotate(s.orientation, v3(0, 1, 0))
  let n = 0
  for (const wheel of WHEELS) {
    if (wheelContact(add(s.position, rotate(s.orientation, wheel.mount)), up, surface)) n++
  }
  return n
}

// Suspension ray along body-down from RAY_LIFT above the mount. Null when the wheel is
// off the ground; otherwise the hit and the spring compression (> REST_LENGTH = penetrating).
function wheelContact(mount: Vec3, up: Vec3, surface: Surface): { hit: RayHit; compression: number } | null {
  const origin = add(mount, scale(up, RAY_LIFT))
  const hit = surface.raycast(origin, scale(up, -1), RAY_LIFT + REST_LENGTH + WHEEL_RADIUS)
  if (!hit) return null
  const dist = hit.distance - RAY_LIFT - WHEEL_RADIUS
  if (dist > REST_LENGTH) return null
  return { hit, compression: Math.min(REST_LENGTH - dist, MAX_COMPRESSION) }
}
