// Fits the Kenney car model to the physics chassis. Pure TypeScript (no three) so
// the fit is unit-testable against the real glb.
import { WHEEL_NODES, type Corner } from '../../car/wheels'

/**
 * Physics chassis, mirrored from src/physics/car.ts (read-only here): wheel mounts
 * at z = ±1.3, WHEEL_RADIUS 0.35, and at rest the wheel centre hangs one radius
 * above the ground, 0.35 below the body origin (SPAWN_HEIGHT 0.7).
 */
export const PHYSICS_WHEELBASE = 2.6
export const PHYSICS_WHEEL_RADIUS = 0.35
export const PHYSICS_WHEEL_DROP = 0.35

export type WheelNode = { name: string; translation: [number, number, number]; radius: number }

export type CarRig = {
  scale: number // uniform model scale, chosen so the wheelbase matches physics
  offset: [number, number, number] // model root offset in the car frame (metres)
  wheelScale: number // extra scale on each wheel so its radius matches physics
  wheelY: number // wheel node y in model units, so wheel centres sit PHYSICS_WHEEL_DROP below the body origin
}

/** Fit the model's wheel nodes onto the physics wheel layout. */
export const fitRig = (wheels: WheelNode[]): CarRig => {
  const byName = new Map(wheels.map((w) => [w.name, w]))
  const get = (c: Corner): WheelNode => {
    const w = byName.get(WHEEL_NODES[c])
    if (!w) throw new Error(`car model has no wheel node "${WHEEL_NODES[c]}"`)
    return w
  }
  const front = get('fl').translation[2]
  const rear = get('rl').translation[2]
  const scale = PHYSICS_WHEELBASE / (front - rear)
  const modelRadius = get('fl').radius
  const wheelY = PHYSICS_WHEEL_RADIUS / scale // centre one physics radius above the model ground plane
  return {
    scale,
    // Centre the wheelbase on the body origin; put the model ground plane at the physics ground.
    offset: [0, -(PHYSICS_WHEEL_DROP + PHYSICS_WHEEL_RADIUS), -((front + rear) / 2) * scale],
    wheelScale: PHYSICS_WHEEL_RADIUS / (modelRadius * scale),
    wheelY,
  }
}

/** Wheel yaw for the car-frame y axis: physics positive steer turns right (toward -x). */
export const wheelYaw = (steerAngle: number): number => -steerAngle

/** Wheel roll rate (rad/s) for a forward speed in m/s. */
export const spinRate = (forwardSpeed: number): number => forwardSpeed / PHYSICS_WHEEL_RADIUS
