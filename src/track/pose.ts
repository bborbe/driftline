// Segment centreline: the one function per segment type for its length, the pose part-way
// through it and the road roll there. Shared by physics (src/physics/surface.ts), the lap loop,
// render (src/render/track/) and the autopilot, so none of them draws a second arc.
// Pure TypeScript: no three, no browser APIs, so physics may import it. schema.ts re-exports it.
import { bankAngleAt } from './bank'
import type { Pose, Segment, Track, Turn } from './schema'

/**
 * Default road width in metres, shoulder to shoulder: the driving width of a segment that sets no
 * `width`. 14 m (1.4 × the 10 m Kenney piece) gives about five car widths of asphalt, nearer a
 * Trackmania road than the old 10 m; a segment widens it for a platform or narrows it for a tech
 * section (widthAt). Never the kit grid: CELL (schema.ts) stays 10 m.
 */
export const ROAD_WIDTH = 14
/** Narrowest and widest road a segment may set (validate.ts). */
export const MIN_ROAD_WIDTH = 8
export const MAX_ROAD_WIDTH = 32

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
    case 'wallride':
      return (seg.radius * seg.angle * Math.PI) / 180
    case 'hairpin':
      return seg.radius * Math.PI
    case 'loop':
      return 2 * Math.PI * seg.radius
  }
}

/**
 * Road width (m) at t (0..1) of the way through a segment — the one width function for physics,
 * render, gates, walls and bodies. `width: w` holds w along the segment; `width: [a, b]` tapers
 * linearly from a at the entry to b at the exit, so a road can widen into a platform and narrow
 * again. No `width`: ROAD_WIDTH, except a loop, which is at most one shift lane (loopShiftOf) so its
 * climb and its exit never share road.
 */
export function widthAt(seg: Segment, t: number): number {
  const w = seg.width
  if (w === undefined) return seg.type === 'loop' ? Math.min(ROAD_WIDTH, loopShiftOf(seg)) : ROAD_WIDTH
  if (typeof w === 'number') return w
  return w[0] + (w[1] - w[0]) * Math.min(1, Math.max(0, t))
}

/** Widest point of a segment's road. */
export const maxWidth = (seg: Segment): number => Math.max(widthAt(seg, 0), widthAt(seg, 1))

/** True when a segment's width is the same all along (no taper). */
export const constantWidth = (seg: Segment): boolean => widthAt(seg, 0) === widthAt(seg, 1)

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
    case 'wallride':
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

/** Default sideways offset of a loop's exit from its entry: one kit CELL (10 m), so its climb and its exit never share road and a kit loop exits on the grid. */
export const LOOP_SHIFT = 10

/** Sideways offset (m) of a loop's exit from its entry: its `shift`, else LOOP_SHIFT. */
export const loopShiftOf = (seg: LoopSegment): number => seg.shift ?? LOOP_SHIFT

/**
 * Lateral offset (m, + = left of the entry heading) of a loop's band centre at sweep θ (0..2π).
 * Eased as θ − sin θ, so the road leaves and rejoins the ground running straight ahead.
 */
export const loopShift = (seg: LoopSegment, theta: number): number =>
  (turnSign(seg) * loopShiftOf(seg) * (theta - Math.sin(theta))) / (2 * Math.PI)

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
    const lateral = s * loopShiftOf(seg)
    return { x: entry.x + Math.cos(entry.heading) * lateral, y: entry.y, z: entry.z - Math.sin(entry.heading) * lateral, heading: entry.heading }
  }
  const theta = 2 * Math.PI * f
  const p = loopPoint(entry, seg, theta)
  const forward = seg.radius * Math.cos(theta)
  const sideways = (s * loopShiftOf(seg) * (1 - Math.cos(theta))) / (2 * Math.PI)
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
    const shift = turnSign(seg) * loopShiftOf(seg)
    return [{ e, r: seg.radius, fx: Math.sin(e.heading), fz: Math.cos(e.heading), lo: Math.min(0, shift) - maxWidth(seg) / 2, hi: Math.max(0, shift) + maxWidth(seg) / 2 }]
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

/** A wallride segment. */
export type WallrideSegment = Extract<Segment, { type: 'wallride' }>

/** Radius (m) of a wallride's quarter-pipe: the wall's cross-section is this circle's lower outer quarter. */
export const WALL_RADIUS = 10

/** Steepest a wallride's wall gets (radians from flat): 85°, near-vertical. */
export const WALL_MAX = (85 * Math.PI) / 180

/** Fraction of a wallride at each end over which its wall rises from nothing to WALL_MAX (and falls back). */
export const WALL_EASE = 0.2

/**
 * How far up its quarter-pipe a wallride's wall reaches at fraction t (0..1) of the turn: the pipe
 * angle (radians) of its top edge. Smoothstep up over the first WALL_EASE, down over the last, so
 * the wall grows out of the road and sinks back into it instead of starting as a cliff.
 */
export function wallTop(t: number): number {
  const e = Math.min(1, Math.max(0, Math.min(t, 1 - t) / WALL_EASE))
  return WALL_MAX * e * e * (3 - 2 * e)
}

/** A wallride's quarter-pipe in its turn's frame: turn centre, the road's outer edge radius and its height. */
export function wallFrame(entry: Pose, seg: WallrideSegment): { cx: number; cz: number; edge: number; y: number } {
  const [cx, cz] = turnCentre(entry, seg.turn, seg.radius)
  return { cx, cz, edge: seg.radius + widthAt(seg, 0) / 2, y: entry.y } // a wallride holds one width (validate.ts)
}

/**
 * The one wallride wall shape: the point at fraction t (0..1) of the turn and pipe angle φ (0 = the
 * road's outer edge, flat; WALL_MAX = near-vertical) of the quarter-pipe that rises outward from the
 * road's outer edge, with the unit normal there pointing in towards the pipe's centre. Physics
 * raycasts that pipe (src/physics/surface.ts) and the render samples this function.
 */
export function wallPoint(entry: Pose, seg: WallrideSegment, t: number, phi: number): LoopPoint {
  const { cx, cz, edge, y } = wallFrame(entry, seg)
  const p = arc(entry, seg.turn, seg.radius, (seg.angle * t * Math.PI) / 180)
  // Unit vector from the turn centre out through the centreline point.
  const ex = (p.x - cx) / seg.radius
  const ez = (p.z - cz) / seg.radius
  const rho = edge + WALL_RADIUS * Math.sin(phi)
  return {
    x: cx + ex * rho,
    y: y + WALL_RADIUS * (1 - Math.cos(phi)),
    z: cz + ez * rho,
    nx: -ex * Math.sin(phi),
    ny: Math.cos(phi),
    nz: -ez * Math.sin(phi),
  }
}
