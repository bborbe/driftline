// Segment centreline: the one function per segment type for its length, the pose part-way
// through it and the road roll there. Shared by physics (src/physics/surface.ts), the lap loop,
// render (src/render/track/) and the autopilot, so none of them draws a second arc.
// Pure TypeScript: no three, no browser APIs, so physics may import it. schema.ts re-exports it.
import { bankAngleAt } from './bank'
import type { Pose, Segment, Track, Turn } from './schema'

/** Road width in metres: the driving width of every piece, shoulder to shoulder (the Kenney road pieces). */
export const ROAD_WIDTH = 10

/** A point on a segment's centreline: world pose and road roll (radians; non-zero on banked turns only). */
export type Sample = Pose & { roll: number }

/** +1 for a left turn, -1 for a right turn (and +1 for straight-line segments). */
export const turnSign = (seg: Segment): number => ('turn' in seg && seg.turn === 'right' ? -1 : 1)

/** Centre [x, z] of the circle a `turn` of `radius` sweeps from pose `p`, perpendicular to its heading. */
export function turnCentre(p: Pose, turn: Turn, radius: number): [number, number] {
  const s = turn === 'left' ? 1 : -1
  return [p.x + Math.cos(p.heading) * radius * s, p.z - Math.sin(p.heading) * radius * s]
}

/** Centreline length of one segment in metres (arcs by radius × angle, ramps/drops by run). */
export function segmentLength(seg: Segment): number {
  switch (seg.type) {
    case 'straight':
    case 'ramp':
    case 'drop':
    case 'gap':
      return seg.length
    case 'curve':
    case 'banked':
      return (seg.radius * seg.angle * Math.PI) / 180
    case 'hairpin':
      return seg.radius * Math.PI
    case 'loop':
      return 2 * Math.PI * seg.radius
  }
}

/** Pose `f` (0..1) of the way through a segment; f = 1 is exactly its exit pose. */
export function partialPose(entry: Pose, seg: Segment, f: number): Pose {
  switch (seg.type) {
    case 'straight':
      return advance(entry, seg.length * f, 0)
    case 'ramp':
      return advance(entry, seg.length * f, seg.rise * f)
    case 'drop':
      return advance(entry, seg.length * f, -(seg.fall * f))
    case 'gap':
      return advance(entry, seg.length * f, -((seg.fall ?? 0) * f))
    case 'curve':
    case 'banked':
      return arc(entry, seg.turn, seg.radius, (seg.angle * f * Math.PI) / 180)
    case 'hairpin':
      return arc(entry, seg.turn, seg.radius, (180 * f * Math.PI) / 180)
    case 'loop':
      return loopPose(entry, seg, f)
  }
}

/** Exit pose of one segment given its entry pose. */
export const exitPose = (entry: Pose, seg: Segment): Pose => partialPose(entry, seg, 1)

/** Centreline sample at t in [0, 1]: the pose plus the eased bank roll physics drives on (src/track/bank.ts). */
export const sampleSegment = (entry: Pose, seg: Segment, t: number): Sample => ({
  ...partialPose(entry, seg, t),
  roll: seg.type === 'banked' ? bankAngleAt(seg.bank, t) : 0,
})

/** Entry pose of every segment followed by the final exit pose (length segments + 1). */
export function poses(track: Track): Pose[] {
  const out = [track.start]
  for (const seg of track.segments) out.push(exitPose(out[out.length - 1], seg))
  return out
}

function advance(p: Pose, length: number, dy: number): Pose {
  return {
    x: p.x + Math.sin(p.heading) * length,
    y: p.y + dy,
    z: p.z + Math.cos(p.heading) * length,
    heading: p.heading,
  }
}

function arc(p: Pose, turn: Turn, radius: number, angle: number): Pose {
  const s = turn === 'left' ? 1 : -1
  const [cx, cz] = turnCentre(p, turn, radius)
  const heading = p.heading + s * angle
  return {
    x: cx - Math.cos(heading) * radius * s,
    y: p.y,
    z: cz + Math.sin(heading) * radius * s,
    heading,
  }
}

/** A loop segment. */
export type LoopSegment = Extract<Segment, { type: 'loop' }>

/** Sideways offset of a loop's exit from its entry: one road width, so its climb and its exit never share road. */
export const LOOP_SHIFT = ROAD_WIDTH

/**
 * Lateral offset (m, + = left of the entry heading) of a loop's band centre at sweep θ (0..2π).
 * Eased as θ − sin θ, so the road leaves and rejoins the ground running straight ahead.
 */
export const loopShift = (seg: LoopSegment, theta: number): number =>
  (turnSign(seg) * LOOP_SHIFT * (theta - Math.sin(theta))) / (2 * Math.PI)

/** A point on a loop's road surface and the unit normal there, pointing in towards the loop's axis. */
export type LoopPoint = { x: number; y: number; z: number; nx: number; ny: number; nz: number }

/**
 * The one loop shape: the road at sweep θ (0 = the entry, π = the top, 2π = the exit) and lateral
 * offset u (m, + = left) from the band centre. It lies on a cylinder of `radius` whose axis runs
 * across the entry heading, `radius` above the entry; physics raycasts that cylinder
 * (src/physics/surface.ts) and the render samples this function, so both draw the same road.
 */
export function loopPoint(entry: Pose, seg: LoopSegment, theta: number, u = 0): LoopPoint {
  const fx = Math.sin(entry.heading)
  const fz = Math.cos(entry.heading)
  const r = seg.radius
  const along = r * Math.sin(theta)
  const lateral = loopShift(seg, theta) + u
  return {
    x: entry.x + fx * along + fz * lateral,
    y: entry.y + r * (1 - Math.cos(theta)),
    z: entry.z + fz * along - fx * lateral,
    nx: -fx * Math.sin(theta),
    ny: Math.cos(theta),
    nz: -fz * Math.sin(theta),
  }
}

// Centreline pose f (0..1) of the way round a loop. The heading follows the horizontal tangent, so
// it turns back on itself over the top; f = 1 is exactly the shifted exit.
function loopPose(entry: Pose, seg: LoopSegment, f: number): Pose {
  const s = turnSign(seg)
  if (f >= 1) {
    const lateral = s * LOOP_SHIFT
    return { x: entry.x + Math.cos(entry.heading) * lateral, y: entry.y, z: entry.z - Math.sin(entry.heading) * lateral, heading: entry.heading }
  }
  const theta = 2 * Math.PI * f
  const p = loopPoint(entry, seg, theta)
  const forward = seg.radius * Math.cos(theta)
  const sideways = (s * LOOP_SHIFT * (1 - Math.cos(theta))) / (2 * Math.PI)
  return { x: p.x, y: p.y, z: p.z, heading: entry.heading + Math.atan2(sideways, forward) }
}

/** Height above a loop's entry below which a point counts as the loop's foot, not inside it. */
export const LOOP_FOOT = 1.5

/**
 * Inside-a-loop test for the track's loops, built once per track: is the point within a loop's
 * tube (the cylinder loopPoint draws on), across its road's sideways sweep, and above its foot?
 * Read by the lap loop (a car that falls off the loop is respawned) and the chase camera (it
 * rolls with the car inside a loop). Always false on a track without a loop.
 */
export function loopTubes(track: Track): (p: { x: number; y: number; z: number }) => boolean {
  const entries = poses(track)
  const tubes = track.segments.flatMap((seg, i) => {
    if (seg.type !== 'loop') return []
    const e = entries[i]
    const shift = turnSign(seg) * LOOP_SHIFT
    return [{ e, r: seg.radius, fx: Math.sin(e.heading), fz: Math.cos(e.heading), lo: Math.min(0, shift) - ROAD_WIDTH / 2, hi: Math.max(0, shift) + ROAD_WIDTH / 2 }]
  })
  if (tubes.length === 0) return () => false
  return (p) =>
    tubes.some(({ e, r, fx, fz, lo, hi }) => {
      const ox = p.x - e.x
      const oz = p.z - e.z
      const along = ox * fx + oz * fz
      const up = p.y - e.y - r
      const left = ox * fz - oz * fx
      return p.y - e.y > LOOP_FOOT && along * along + up * up < r * r && left >= lo && left <= hi
    })
}
