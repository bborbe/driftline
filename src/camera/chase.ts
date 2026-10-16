// Chase camera math, free of three.js so it can be unit-tested.
import { add, length, normalize, scale, sub, v3, type Vec3 } from '../physics/vec'
import { MAX_SPEED } from '../physics/car'

export const FOV_REST = 70
export const FOV_MAX = 90
export const MAX_DISTANCE = 8
const BACK = 5
const HEIGHT = 2
const STIFFNESS = 10 // 1/s

export type ChaseCamera = { position: Vec3; fov: number }

export const fovForSpeed = (speed: number): number =>
  FOV_REST + (FOV_MAX - FOV_REST) * Math.min(1, Math.max(0, speed / MAX_SPEED))

export const createChase = (target: Vec3, forward: Vec3): ChaseCamera => ({
  position: desired(target, forward),
  fov: FOV_REST,
})

const desired = (target: Vec3, forward: Vec3): Vec3 => {
  const flat = normalize(v3(forward.x, 0, forward.z))
  return add(add(target, scale(flat, -BACK)), v3(0, HEIGHT, 0))
}

export const updateChase = (cam: ChaseCamera, target: Vec3, forward: Vec3, speed: number, dt: number): ChaseCamera => {
  const want = desired(target, forward)
  const k = 1 - Math.exp(-STIFFNESS * dt)
  let position = add(cam.position, scale(sub(want, cam.position), k))
  const offset = sub(position, target)
  const d = length(offset)
  const limit = MAX_DISTANCE - 1e-6
  if (d > limit) position = add(target, scale(offset, limit / d))
  return { position, fov: fovForSpeed(speed) }
}
