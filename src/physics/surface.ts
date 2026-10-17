// Drivable surfaces for the wheel raycasts. Pure and deterministic: no three.js,
// no clocks, no randomness. Built from the shared track format in src/track/schema.ts.
import { barrierPillars, barrierPosts, gatePillars, isPad, padForward, poses, ROAD_WIDTH, turnCentre, type Pillar, type Pose, type Segment, type Track, type ZoneKind } from '../track/schema'
import { bodyBoxes, pillarBoxes } from '../track/bodies'
import { loopShift, type LoopSegment } from '../track/pose'
import { bankAngleAt, bankAngleSlope, bankRise } from '../track/bank'
import { normalize, v3, type Vec3 } from './vec'

/**
 * What a wheel stands on: plain road, a zone kind (turbo pad, dirt, ice, grass), or 'offroad' —
 * the open ground beside the track, which no piece covers.
 */
export type Material = 'road' | ZoneKind | 'offroad'

export type RayHit = {
  distance: number // along the (unit) ray direction
  normal: Vec3 // unit, pointing up out of the surface
  material?: Material // omitted = 'road'
  padForward?: Vec3 // turbo pads only: unit horizontal direction of the arrow
  loop?: true // the inside of a loop, where the road is not under the car (src/track/pose.ts)
}

export interface Surface {
  // Ray from `origin` along unit `dir`; null when nothing is hit within `maxDistance`.
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null
  // Solid upright boxes the car body collides with (gate pillars, barriers, filled bodies under raised road, bridge pillars); none when omitted.
  obstacles?: readonly Pillar[]
}

// Driving width of every track piece (ROAD_WIDTH, src/track/pose.ts); pieces sit on a CELL grid.
export const TRACK_WIDTH = ROAD_WIDTH

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

// curve / hairpin / banked: an annular sector around the turn centre (turnCentre, the same
// circle pose.ts sweeps the centreline on). `bank` raises the outer edge about the centreline,
// easing in and out at both ends (src/track/bank.ts — shared with the renderer).
const sector = (p: Pose, left: boolean, radius: number, angle: number, bank: number, width: number): Piece => {
  const s = left ? 1 : -1
  const [cx, cz] = turnCentre(p, left ? 'left' : 'right', radius)
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
    case 'loop':
      return () => null // not a height field: raycast by loopRaycast below
  }
}

/**
 * A loop's road (src/track/pose.ts loopPoint): the inner face of a cylinder of `radius` about an
 * axis across the entry heading, `radius` above the entry, inside the band that drifts LOOP_SHIFT
 * sideways over the turn. Rays are taken in any direction — a wheel on the loop casts along the
 * car's own down, sideways or upwards — and only from inside the tube, where the road faces them.
 * Gravity stays world −y, so a car stays on only while its speed presses the wheels into the road.
 */
const loopRaycast = (p: Pose, seg: LoopSegment, width: number): Surface['raycast'] => {
  const fx = Math.sin(p.heading)
  const fz = Math.cos(p.heading)
  const r = seg.radius
  return (origin, dir, maxDistance) => {
    // The origin and direction in the loop's frame: along the entry heading, up, and left.
    const ox = origin.x - p.x
    const oz = origin.z - p.z
    const of = ox * fx + oz * fz
    const ou = origin.y - (p.y + r)
    const ol = ox * fz - oz * fx
    const df = dir.x * fx + dir.z * fz
    const du = dir.y
    const a = df * df + du * du
    const c = of * of + ou * ou - r * r
    if (a < 1e-12 || c >= 0) return null // along the axis, or outside the tube
    const b = of * df + ou * du
    const distance = (-b + Math.sqrt(b * b - a * c)) / a
    if (distance > maxDistance) return null
    const hf = of + distance * df
    const hu = ou + distance * du
    let theta = Math.atan2(hf, -hu)
    if (theta < 0) theta += TWO_PI
    if (Math.abs(ol + distance * (dir.x * fz - dir.z * fx) - loopShift(seg, theta)) > width / 2) return null
    return { distance, normal: v3((-hf / r) * fx, -hu / r, (-hf / r) * fz), loop: true }
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
  const padDirs = zones.map((z) => {
    const [x, z2] = padForward(track, z)
    return v3(x, 0, z2)
  })
  const zoneAt = (h: Height): number => {
    if (h.piece < 0) return -1
    return zones.findIndex((z) => z.segment === h.piece && h.t >= z.from && h.t <= z.to)
  }

  // Highest surface at (x, z) that is not above `maxY`.
  const heightAt = (x: number, z: number, maxY: number): Height | null => {
    let best: Height | null = groundY !== null && groundY <= maxY ? { y: groundY, gx: 0, gz: 0, t: 0, piece: -1 } : null
    let sunk: Height | null = null
    for (let i = 0; i < pieces.length; i++) {
      const h = pieces[i](x, z)
      if (!h) continue
      // A piece level with the ground plane wins over it, so its zones apply.
      if (h.y <= maxY && (!best || h.y > best.y || (best.piece < 0 && h.y === best.y))) best = { ...h, piece: i }
      if (groundY !== null && h.y < groundY && !sunk) sunk = { ...h, piece: i }
    }
    // The inner half of a banked turn dips below the ground plane, which then carries the wheel:
    // that is still the road (its material), not the open ground beside it.
    if (best && best.piece < 0 && sunk) return { ...best, t: sunk.t, piece: sunk.piece }
    return best
  }

  // Height-field pieces: the highest surface below a downward ray.
  const fieldRaycast: Surface['raycast'] = (origin, dir, maxDistance) => {
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
    if (h.piece < 0) return { distance: t, normal, material: 'offroad' }
    const zi = zoneAt(h)
    if (zi < 0) return { distance: t, normal }
    const material = zones[zi].kind
    return isPad(material) ? { distance: t, normal, material, padForward: padDirs[zi] } : { distance: t, normal, material }
  }
  const loops = track.segments.flatMap((seg, i) => (seg.type === 'loop' ? [loopRaycast(entries[i], seg, width)] : []))
  // A track without a loop keeps the height field's raycast itself, so it drives bit-identically.
  const raycast: Surface['raycast'] =
    loops.length === 0
      ? fieldRaycast
      : (origin, dir, maxDistance) => {
          let best = fieldRaycast(origin, dir, maxDistance)
          for (const loop of loops) {
            const hit = loop(origin, dir, maxDistance)
            if (hit && (!best || hit.distance < best.distance)) best = hit
          }
          return best
        }

  return {
    obstacles: [
      ...track.gates.filter((g) => g.segment < track.segments.length).flatMap((g) => gatePillars(track, g)),
      ...barrierPillars(track),
      ...barrierPosts(track),
      // Last, so a track with no raised road keeps every earlier collision in the same order.
      ...bodyBoxes(track),
      ...pillarBoxes(track),
    ],
    raycast,
  }
}
