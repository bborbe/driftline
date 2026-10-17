// Chase camera math, free of three.js so it can be unit-tested.
import { add, length, normalize, rotate, scale, sub, v3, type Quat, type Vec3 } from '../physics/vec'
import { MAX_SPEED } from '../physics/car'

export const FOV_REST = 70
export const FOV_MAX = 90
export const MAX_DISTANCE = 8
const STIFFNESS = 10 // 1/s

/** `up` is the camera's up vector: world up, except while it rolls with the car through a loop. */
export type ChaseCamera = { position: Vec3; fov: number; up: Vec3 }

const WORLD_UP = v3(0, 1, 0)

/** Camera rig: how far behind and above the car it sits, and how far it may lag. */
export type ChaseRig = { back: number; height: number; maxDistance: number }
export const CLOSE_RIG: ChaseRig = { back: 5, height: 2, maxDistance: MAX_DISTANCE }
export const FAR_RIG: ChaseRig = { back: 9, height: 3.5, maxDistance: 13 }

export const fovForSpeed = (speed: number): number =>
  FOV_REST + (FOV_MAX - FOV_REST) * Math.min(1, Math.max(0, speed / MAX_SPEED))

export const createChase = (target: Vec3, forward: Vec3, rig: ChaseRig = CLOSE_RIG): ChaseCamera => ({
  position: desired(target, forward, rig),
  fov: FOV_REST,
  up: WORLD_UP,
})

// Behind and above the car: along its heading on the ground plane and world up, or — inside a
// loop, where the heading points up the wall — along the car's own forward and up.
const desired = (target: Vec3, forward: Vec3, rig: ChaseRig, carUp?: Vec3): Vec3 => {
  if (carUp) return add(add(target, scale(forward, -rig.back)), scale(carUp, rig.height))
  const flat = normalize(v3(forward.x, 0, forward.z))
  return add(add(target, scale(flat, -rig.back)), v3(0, rig.height, 0))
}

export const updateChase = (
  cam: ChaseCamera,
  target: Vec3,
  forward: Vec3,
  speed: number,
  dt: number,
  rig: ChaseRig = CLOSE_RIG,
  carUp?: Vec3,
): ChaseCamera => {
  const want = desired(target, forward, rig, carUp)
  const k = 1 - Math.exp(-STIFFNESS * dt)
  // Rolls with the car while `carUp` is given (inside a loop), back to world up after; exactly world up on any other road.
  const up = normalize(add(cam.up, scale(sub(carUp ?? WORLD_UP, cam.up), k)))
  let position = add(cam.position, scale(sub(want, cam.position), k))
  const offset = sub(position, target)
  const d = length(offset)
  const limit = rig.maxDistance - 1e-6
  if (d > limit) position = add(target, scale(offset, limit / d))
  return { position, fov: fovForSpeed(speed), up }
}

// In-car view: eye at the driver's head in the body frame, rigidly attached.
const EYE = v3(0, 0.55, -0.2)
const LOOK = v3(0, 0.45, 10)
export const COCKPIT_FOV = 75

/** Eye position, look-at point and up vector for the in-car view. */
export const cockpitPose = (position: Vec3, orientation: Quat): { eye: Vec3; look: Vec3; up: Vec3 } => ({
  eye: add(position, rotate(orientation, EYE)),
  look: add(position, rotate(orientation, LOOK)),
  up: rotate(orientation, v3(0, 1, 0)),
})
