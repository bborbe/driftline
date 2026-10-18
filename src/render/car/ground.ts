// The drawn road's height over the physics surface, so the wheels stand on the asphalt they are drawn
// on. Physics drives on the schema pose (y 0 on a flat road); the drawn road copies the Kenney tiles
// (src/render/track/geometry.ts PROFILE): asphalt 0.1 m up, curbs 0.2 m, grass shoulders and the open
// ground at 0, a wallride's wall on the physics face. Render-only: shortens the drawn spring length,
// never the physics one. Pure TypeScript so it is unit-testable.
import { add, rotate, scale, sub, v3, type CarState, type Vec3 } from '../../physics'
import { centreline } from '../../track/centreline'
import { CELL, type Pose, type Track } from '../../track/schema'
import { CENTRE_COLUMN, PROFILE } from '../track/geometry'
import { PHYSICS_WHEEL_RADIUS } from './rig'

const STEP = 1 // m between centreline samples
// Height window (m) between the car and the centreline pose, so a road passing under a bridge never counts.
const MAX_DY = 2

type Spring = { mount: Vec3; length: number }
type Near = Pose & { width: number }

/** Drawn surface height (m) over the physics surface at lateral offset `u` on a road `width` wide; 0 past the shoulders. */
export const profileHeight = (u: number, width: number): number => {
  const a = (Math.abs(u) * CELL) / width
  // PROFILE runs from the left edge (+u) to the right edge; walk out from the centre column on the + side.
  for (let j = CENTRE_COLUMN; j > 0; j--) {
    const [u0, h0] = PROFILE[j]
    const [u1, h1] = PROFILE[j - 1]
    if (a <= u1) return u1 === u0 ? h0 : h0 + ((a - u0) / (u1 - u0)) * (h1 - h0)
  }
  return 0
}

/** Lateral (left of the heading) and longitudinal offset (m) of (x, z) from pose `p`; forward = (sin h, cos h). */
const offsets = (p: Pose, x: number, z: number): [number, number] => [
  (x - p.x) * Math.cos(p.heading) - (z - p.z) * Math.sin(p.heading),
  (x - p.x) * Math.sin(p.heading) + (z - p.z) * Math.cos(p.heading),
]

export class RoadTop {
  private readonly line: Near[]

  constructor(track: Track) {
    this.line = centreline(track, STEP)
  }

  /** Drawn surface height (m) over the physics surface at world point `at`: 0 away from every road at its height. */
  heightAt(at: Vec3): number {
    let near: Near | null = null
    let bestD = Infinity
    for (const p of this.line) {
      if (Math.abs(at.y - p.y) > MAX_DY) continue
      const d = (at.x - p.x) ** 2 + (at.z - p.z) ** 2
      if (d < bestD) {
        bestD = d
        near = p
      }
    }
    if (!near) return 0
    // Past an open end of the lap the nearest sample lies behind or ahead of the point, not beside it.
    const [u, along] = offsets(near, at.x, at.z)
    return Math.abs(along) > STEP ? 0 : profileHeight(u, near.width)
  }
}

/**
 * Spring lengths as drawn: each wheel's physics length shortened by the drawn road's height under its
 * contact point, so the wheel sits on the drawn asphalt rather than that far inside it.
 */
export const drawnTravel = (springs: readonly Spring[], s: CarState, ground?: RoadTop): Spring[] => {
  if (!ground) return [...springs]
  const up = rotate(s.orientation, v3(0, 1, 0))
  return springs.map((w) => {
    const contact = sub(add(s.position, rotate(s.orientation, w.mount)), scale(up, w.length + PHYSICS_WHEEL_RADIUS))
    return { mount: w.mount, length: w.length - ground.heightAt(contact) }
  })
}
