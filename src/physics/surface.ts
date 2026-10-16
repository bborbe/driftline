// Drivable surfaces for the wheel raycasts. Pure and deterministic: no three.js,
// no clocks, no randomness. Built from the shared track format in src/track/schema.ts.
import { CELL, poses, type Pose, type Segment, type Track } from '../track/schema'
import { normalize, v3, type Vec3 } from './vec'

export type RayHit = {
  distance: number // along the (unit) ray direction
  normal: Vec3 // unit, pointing up out of the surface
}

export interface Surface {
  // Ray from `origin` along unit `dir`; null when nothing is hit within `maxDistance`.
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null
}

// Driving width of every track piece; pieces sit on a CELL grid.
export const TRACK_WIDTH = CELL

const UP = v3(0, 1, 0)

// Infinite horizontal plane — the scaffold's original y = 0 ground.
export const flatSurface = (groundY = 0): Surface => ({
  raycast(origin, dir, maxDistance) {
    if (dir.y >= -1e-6) return null
    const distance = (groundY - origin.y) / dir.y
    return distance <= maxDistance ? { distance, normal: UP } : null
  },
})

export const FLAT: Surface = flatSurface()

// Height of a surface at (x, z) with its gradient dy/dx, dy/dz.
type Height = { y: number; gx: number; gz: number }
type Piece = (x: number, z: number) => Height | null

const TWO_PI = 2 * Math.PI

// straight / ramp / drop: a planar strip from the entry pose, rising linearly by `dy`.
const strip = (p: Pose, length: number, dy: number, width: number): Piece => {
  const fx = Math.sin(p.heading)
  const fz = Math.cos(p.heading)
  const slope = dy / length
  return (x, z) => {
    const rx = x - p.x
    const rz = z - p.z
    const u = rx * fx + rz * fz
    const lat = rx * fz - rz * fx
    if (u < 0 || u > length || Math.abs(lat) > width / 2) return null
    return { y: p.y + slope * u, gx: slope * fx, gz: slope * fz }
  }
}

// curve / hairpin / banked: an annular sector around the turn centre (same geometry as
// schema.ts `arc`). `bank` raises the outer edge: y = entry.y + (r - radius) · tan(bank).
const sector = (p: Pose, left: boolean, radius: number, angle: number, bank: number, width: number): Piece => {
  const s = left ? 1 : -1
  const cx = p.x + Math.cos(p.heading) * radius * s
  const cz = p.z - Math.sin(p.heading) * radius * s
  const tb = Math.tan(bank)
  return (x, z) => {
    const rx = x - cx
    const rz = z - cz
    const r = Math.hypot(rx, rz)
    if (r < 1e-9 || Math.abs(r - radius) > width / 2) return null
    // The arc point at sweep θ is centre + radius · (-s·cos(h + sθ), s·sin(h + sθ)).
    let theta = s * (Math.atan2(s * rz, -s * rx) - p.heading)
    theta = ((theta % TWO_PI) + TWO_PI) % TWO_PI
    if (theta > angle) return null
    return { y: p.y + (r - radius) * tb, gx: (tb * rx) / r, gz: (tb * rz) / r }
  }
}

const piece = (p: Pose, seg: Segment, width: number): Piece => {
  switch (seg.type) {
    case 'straight':
      return strip(p, seg.length, 0, width)
    case 'ramp':
      return strip(p, seg.length, seg.rise, width)
    case 'drop':
      return strip(p, seg.length, -seg.fall, width)
    case 'curve':
      return sector(p, seg.turn === 'left', seg.radius, (seg.angle * Math.PI) / 180, 0, width)
    case 'hairpin':
      return sector(p, seg.turn === 'left', seg.radius, Math.PI, 0, width)
    case 'banked':
      return sector(p, seg.turn === 'left', seg.radius, (seg.angle * Math.PI) / 180, seg.bank, width)
  }
}

export type TrackSurfaceOptions = {
  width?: number // default TRACK_WIDTH
  groundY?: number | null // infinite ground plane under the track; null = none
}

// Fixed-point iterations for ray ∩ height field. Converges while |∇h| · |tan(ray tilt)| < 1,
// which holds for every piece (bank ≤ ~45°) with the car near upright.
const ITERATIONS = 8
// A surface may sit this far above the ray origin and still be hit (compressed wheels).
const ABOVE = 0.1

export const trackSurface = (track: Track, options: TrackSurfaceOptions = {}): Surface => {
  const width = options.width ?? TRACK_WIDTH
  const groundY = options.groundY === undefined ? 0 : options.groundY
  const entries = poses(track)
  const pieces = track.segments.map((seg, i) => piece(entries[i], seg, width))

  // Highest surface at (x, z) that is not above `maxY`.
  const heightAt = (x: number, z: number, maxY: number): Height | null => {
    let best: Height | null = groundY !== null && groundY <= maxY ? { y: groundY, gx: 0, gz: 0 } : null
    for (const p of pieces) {
      const h = p(x, z)
      if (h && h.y <= maxY && (!best || h.y > best.y)) best = h
    }
    return best
  }

  return {
    raycast(origin, dir, maxDistance) {
      if (dir.y >= -1e-6) return null
      const maxY = origin.y + ABOVE
      let t = 0
      let h: Height | null = null
      for (let i = 0; i < ITERATIONS; i++) {
        h = heightAt(origin.x + dir.x * t, origin.z + dir.z * t, maxY)
        if (!h) return null
        t = (h.y - origin.y) / dir.y
      }
      if (!h || t > maxDistance) return null
      return { distance: t, normal: normalize(v3(-h.gx, 1, -h.gz)) }
    },
  }
}
