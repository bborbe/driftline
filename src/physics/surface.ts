// Drivable surfaces for the wheel raycasts. Pure and deterministic: no three.js,
// no clocks, no randomness. Built from the shared track format in src/track/schema.ts.
import { CELL, gatePillars, poses, type Pillar, type Pose, type Segment, type Track, type ZoneKind } from '../track/schema'
import { bankAngleAt, bankAngleSlope, bankRise } from '../track/bank'
import { normalize, v3, type Vec3 } from './vec'

/** What a wheel stands on: plain road, or a zone kind (turbo pad, dirt, ice, grass). */
export type Material = 'road' | ZoneKind

export type RayHit = {
  distance: number // along the (unit) ray direction
  normal: Vec3 // unit, pointing up out of the surface
  material?: Material // omitted = 'road'
}

export interface Surface {
  // Ray from `origin` along unit `dir`; null when nothing is hit within `maxDistance`.
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null
  // Solid upright boxes the car body collides with (gate pillars); none when omitted.
  obstacles?: readonly Pillar[]
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

// Height of a surface at (x, z) with its gradient dy/dx, dy/dz, and the fraction `t` (0..1)
// of the piece's length at that point (0 for the ground plane).
type Height = { y: number; gx: number; gz: number; t: number; piece: number }
type Shape = Omit<Height, 'piece'>
type Piece = (x: number, z: number) => Shape | null

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
    return { y: p.y + slope * u, gx: slope * fx, gz: slope * fz, t: u / length }
  }
}

// curve / hairpin / banked: an annular sector around the turn centre (same geometry as
// schema.ts `arc`). `bank` raises the outer edge about the centreline, easing in and out at
// both ends (src/track/bank.ts — shared with the renderer).
const sector = (p: Pose, left: boolean, radius: number, angle: number, bank: number, width: number): Piece => {
  const s = left ? 1 : -1
  const cx = p.x + Math.cos(p.heading) * radius * s
  const cz = p.z - Math.sin(p.heading) * radius * s
  return (x, z) => {
    const rx = x - cx
    const rz = z - cz
    const r = Math.hypot(rx, rz)
    if (r < 1e-9 || Math.abs(r - radius) > width / 2) return null
    // The arc point at sweep θ is centre + radius · (-s·cos(h + sθ), s·sin(h + sθ)).
    let theta = s * (Math.atan2(s * rz, -s * rx) - p.heading)
    theta = ((theta % TWO_PI) + TWO_PI) % TWO_PI
    if (theta > angle) return null
    const t = theta / angle
    if (bank === 0) return { y: p.y, gx: 0, gz: 0, t }
    const b = bankAngleAt(bank, t)
    const tb = Math.tan(b)
    // h(r, θ) = (r - radius) · tan(b(θ/angle)); ∇r = (rx, rz)/r, ∇θ = s · (rz, -rx)/r².
    const dhdTheta = ((r - radius) * bankAngleSlope(bank, t)) / (Math.cos(b) ** 2 * angle)
    return {
      y: p.y + bankRise(b, r - radius),
      gx: (tb * rx) / r + (dhdTheta * s * rz) / (r * r),
      gz: (tb * rz) / r - (dhdTheta * s * rx) / (r * r),
      t,
    }
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
    case 'gap':
      return () => null // no road: the car flies across or falls
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
  const zones = track.zones ?? []
  const materialAt = (h: Height): Material => {
    for (const z of zones) if (z.segment === h.piece && h.t >= z.from && h.t <= z.to) return z.kind
    return 'road'
  }

  // Highest surface at (x, z) that is not above `maxY`.
  const heightAt = (x: number, z: number, maxY: number): Height | null => {
    let best: Height | null = groundY !== null && groundY <= maxY ? { y: groundY, gx: 0, gz: 0, t: 0, piece: -1 } : null
    pieces.forEach((p, i) => {
      const h = p(x, z)
      // A piece level with the ground plane wins over it, so its zones apply.
      if (h && h.y <= maxY && (!best || h.y > best.y || (best.piece < 0 && h.y === best.y))) best = { ...h, piece: i }
    })
    return best
  }

  return {
    obstacles: track.gates.filter((g) => g.segment < track.segments.length).flatMap((g) => gatePillars(track, g)),
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
      const normal = normalize(v3(-h.gx, 1, -h.gz))
      const material = materialAt(h)
      return material === 'road' ? { distance: t, normal } : { distance: t, normal, material }
    },
  }
}
