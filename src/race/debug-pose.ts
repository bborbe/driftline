// URL debug spawn for screenshots: `?x=-108&y=0.8&z=-59&yaw=90` places the car at that pose
// (yaw in degrees, 0 = +z, CCW positive); `&roll=75` leans it about its nose (degrees, + = top to
// the left: on a wallride's wall or, at 180, upside down at a loop's top); `&freeze=1` holds physics and the countdown.
import type { Quat } from '../physics/vec'
import type { Pose } from '../track/schema'

/** Spawn pose from a URL query string, or null unless x, y, z and yaw are all numbers. */
export function debugPose(search: string): Pose | null {
  const q = new URLSearchParams(search)
  const [x, y, z, yaw] = ['x', 'y', 'z', 'yaw'].map((k) => (q.get(k) === null || q.get(k) === '' ? NaN : Number(q.get(k))))
  if (![x, y, z, yaw].every(Number.isFinite)) return null
  return { x, y, z, heading: (yaw * Math.PI) / 180 }
}

/** `?roll=` in degrees (+ = the car's top to its left), 0 when absent or not a number. */
export function debugRoll(search: string): number {
  const r = Number(new URLSearchParams(search).get('roll') ?? '')
  return Number.isFinite(r) ? r : 0
}

/** Orientation for heading `heading` (radians) leaned `rollDeg` about the nose: yaw, then roll (local +x is the car's left). */
export function yawRoll(heading: number, rollDeg: number): Quat {
  const a = (-rollDeg * Math.PI) / 360
  const h = heading / 2
  // (0, sin h, 0, cos h) ⊗ (0, 0, sin a, cos a)
  return { x: Math.sin(h) * Math.sin(a), y: Math.sin(h) * Math.cos(a), z: Math.cos(h) * Math.sin(a), w: Math.cos(h) * Math.cos(a) }
}

/** `?freeze=1`: hold the car and the lap timer still. */
export const frozen = (search: string): boolean => new URLSearchParams(search).get('freeze') === '1'

/** Heading in the `?yaw=` convention (degrees, 0 = +z, CCW positive, -180..180) from a forward vector. */
export const yawDeg = (forward: { x: number; z: number }): number => (Math.atan2(forward.x, forward.z) * 180) / Math.PI

/** Debug-spawn query for the current pose (docs/development.md § Debug screenshots), frozen so the frame holds still. */
export function poseQuery(track: string, p: { x: number; y: number; z: number }, yaw: number): string {
  const q = new URLSearchParams({ track, x: p.x.toFixed(1), y: p.y.toFixed(1), z: p.z.toFixed(1), yaw: yaw.toFixed(0), freeze: '1' })
  return `?${q}`
}
