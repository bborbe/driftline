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
