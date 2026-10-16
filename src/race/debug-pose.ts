// URL debug spawn for screenshots: `?x=-108&y=0.8&z=-59&yaw=90` places the car at that pose
// (yaw in degrees, 0 = +z, CCW positive); `&freeze=1` holds physics and the countdown.
import type { Pose } from '../track/schema'

/** Spawn pose from a URL query string, or null unless x, y, z and yaw are all numbers. */
export function debugPose(search: string): Pose | null {
  const q = new URLSearchParams(search)
  const [x, y, z, yaw] = ['x', 'y', 'z', 'yaw'].map((k) => (q.get(k) === null || q.get(k) === '' ? NaN : Number(q.get(k))))
  if (![x, y, z, yaw].every(Number.isFinite)) return null
  return { x, y, z, heading: (yaw * Math.PI) / 180 }
}

/** `?freeze=1`: hold the car and the lap timer still. */
export const frozen = (search: string): boolean => new URLSearchParams(search).get('freeze') === '1'
