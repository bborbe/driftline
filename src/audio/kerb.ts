// Is the car on a curb? Pure: the lateral offset from the nearest centreline pose against the curb band of the
// road cross-section (src/render/track/geometry.ts PROFILE: curbs from 3.45 m to 4.18 m on a CELL-wide road).
import { centreline } from '../track/centreline'
import { CELL, type Pose, type Track } from '../track/schema'

/** Curb band on a CELL-wide road, metres from the centreline; stretched by width / CELL like PROFILE. */
export const KERB_INNER = 3.45
export const KERB_OUTER = 4.18
// The wheels sit ~0.8 m either side of the car's centre, so a wheel is on the curb a little before the centre is.
const WHEEL_HALF_TRACK = 0.8
// Height window (m) between the car and the centreline pose, so a road passing under a bridge never counts.
const MAX_DY = 2
const STEP = 1

/** Whether a wheel of a car at lateral offset `u` (m) is on the curb of a road `width` wide. */
export const onKerbBand = (u: number, width: number): boolean => {
  const k = width / CELL
  const a = Math.abs(u)
  return a + WHEEL_HALF_TRACK >= KERB_INNER * k && a - WHEEL_HALF_TRACK <= KERB_OUTER * k
}

/** Signed lateral offset (m) of point (x, z) from pose `p`, perpendicular to its heading (forward = (sin h, cos h)). */
export const lateralOffset = (p: Pose, x: number, z: number): number => (x - p.x) * Math.cos(p.heading) - (z - p.z) * Math.sin(p.heading)

export class KerbProbe {
  private readonly line: (Pose & { width: number })[]

  constructor(track: Track) {
    this.line = centreline(track, STEP)
  }

  /** True when the car at `pos` rides a curb of the nearest road at its own height. */
  onKerb(pos: { x: number; y: number; z: number }): boolean {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.line.length; i++) {
      const p = this.line[i]
      if (Math.abs(pos.y - p.y) > MAX_DY) continue
      const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) return false
    const p = this.line[best]
    return onKerbBand(lateralOffset(p, pos.x, pos.z), p.width)
  }
}
