// Shared track format. Consumed by render (src/render/), physics (src/physics/)
// and the lap loop (src/race/). Pure TypeScript: no three, no browser APIs, so
// physics may import it.

/** Grid cell size in metres. Every piece's footprint is a multiple of it. */
export const CELL = 10

/** World pose at a piece connection edge: bottom-center, heading in radians (0 = +z, CCW positive). */
export interface Pose {
  x: number
  y: number
  z: number
  heading: number
}

export type Turn = 'left' | 'right'

export type Segment =
  | { type: 'straight'; length: number }
  | { type: 'curve'; turn: Turn; radius: number; angle: 90 | 45 }
  | { type: 'hairpin'; turn: Turn; radius: number }
  | { type: 'ramp'; length: number; rise: number }
  | { type: 'drop'; length: number; fall: number }
  | { type: 'banked'; turn: Turn; radius: number; angle: 90 | 180; bank: number }

export type SegmentType = Segment['type']

export const SEGMENT_TYPES: readonly SegmentType[] = ['straight', 'curve', 'hairpin', 'ramp', 'drop', 'banked']

export type GateKind = 'start-finish' | 'checkpoint'

/** A gate sits on the entry edge of segment `segment` (index into Track.segments). */
export interface Gate {
  kind: GateKind
  segment: number
}

export interface Track {
  name: string
  start: Pose
  segments: Segment[]
  gates: Gate[]
}

/** Exit pose of one segment given its entry pose. */
export function exitPose(entry: Pose, seg: Segment): Pose {
  switch (seg.type) {
    case 'straight':
      return advance(entry, seg.length, 0)
    case 'ramp':
      return advance(entry, seg.length, seg.rise)
    case 'drop':
      return advance(entry, seg.length, -seg.fall)
    case 'curve':
      return arc(entry, seg.turn, seg.radius, (seg.angle * Math.PI) / 180)
    case 'hairpin':
      return arc(entry, seg.turn, seg.radius, Math.PI)
    case 'banked':
      return arc(entry, seg.turn, seg.radius, (seg.angle * Math.PI) / 180)
  }
}

/** Native length of a straight road tile (assets/track/pieces.json); straights are split into tiles of about this length. */
export const TILE_LENGTH = 20

/** Length of each tile a straight of `length` is split into (whole tiles, stretched to fit). */
export const tileLength = (length: number): number => length / Math.max(1, Math.round(length / TILE_LENGTH))

/**
 * The start/finish arch stands this fraction of the way along its start tile: the Kenney
 * roadStart banner sits mid-tile (pinned by src/track/assets.test.ts against the model).
 */
export const START_ARCH_FRACTION = 0.5

/**
 * Where a gate's line actually is — the single source for the lap trigger (src/race) and
 * the arch (src/render). Checkpoints sit on their segment's entry edge; a start/finish gate
 * on a straight sits under the start tile's arch.
 */
export function gateLine(track: Track, gate: Gate): Pose {
  const entry = poses(track)[gate.segment]
  const seg = track.segments[gate.segment]
  if (gate.kind !== 'start-finish' || seg.type !== 'straight') return entry
  return exitPose(entry, { type: 'straight', length: tileLength(seg.length) * START_ARCH_FRACTION })
}

/**
 * Short stable id of a track's layout (start, segments, gates; not its name). Changes whenever
 * the geometry or gates change, so per-layout records start fresh after a redesign. FNV-1a, 8 hex.
 */
export function layoutId(track: Track): string {
  const text = JSON.stringify([track.start, track.segments, track.gates])
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

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
  // Center of the turn circle, perpendicular to heading.
  const cx = p.x + Math.cos(p.heading) * radius * s
  const cz = p.z - Math.sin(p.heading) * radius * s
  const heading = p.heading + s * angle
  return {
    x: cx - Math.cos(heading) * radius * s,
    y: p.y,
    z: cz + Math.sin(heading) * radius * s,
    heading,
  }
}

/** Structural validation of untrusted JSON. Returns a list of problems, empty when valid. */
export function validate(data: unknown): string[] {
  const errs: string[] = []
  const t = data as Partial<Track>
  if (typeof t !== 'object' || t === null) return ['track is not an object']
  if (typeof t.name !== 'string') errs.push('name must be a string')
  if (!isPose(t.start)) errs.push('start must be a pose {x,y,z,heading}')
  if (!Array.isArray(t.segments) || t.segments.length === 0) {
    errs.push('segments must be a non-empty array')
  } else {
    t.segments.forEach((s, i) => {
      const e = segmentError(s)
      if (e) errs.push(`segments[${i}]: ${e}`)
    })
  }
  if (!Array.isArray(t.gates)) {
    errs.push('gates must be an array')
  } else {
    const n = Array.isArray(t.segments) ? t.segments.length : 0
    t.gates.forEach((g, i) => {
      if (g?.kind !== 'start-finish' && g?.kind !== 'checkpoint') errs.push(`gates[${i}]: unknown kind`)
      if (!Number.isInteger(g?.segment) || g.segment < 0 || g.segment >= n) errs.push(`gates[${i}]: segment out of range`)
    })
  }
  return errs
}

function isPose(p: unknown): p is Pose {
  const o = p as Pose
  return typeof o === 'object' && o !== null && [o.x, o.y, o.z, o.heading].every((v) => Number.isFinite(v))
}

function pos(v: unknown): boolean {
  return Number.isFinite(v) && (v as number) > 0
}

function segmentError(s: unknown): string | null {
  const o = s as Record<string, unknown>
  if (typeof o !== 'object' || o === null) return 'not an object'
  const turnOk = o.turn === 'left' || o.turn === 'right'
  switch (o.type) {
    case 'straight':
      return pos(o.length) ? null : 'length must be > 0'
    case 'ramp':
      return pos(o.length) && pos(o.rise) ? null : 'length and rise must be > 0'
    case 'drop':
      return pos(o.length) && pos(o.fall) ? null : 'length and fall must be > 0'
    case 'curve':
      return turnOk && pos(o.radius) && (o.angle === 90 || o.angle === 45) ? null : 'needs turn, radius > 0, angle 45|90'
    case 'hairpin':
      return turnOk && pos(o.radius) ? null : 'needs turn, radius > 0'
    case 'banked':
      return turnOk && pos(o.radius) && (o.angle === 90 || o.angle === 180) && Number.isFinite(o.bank)
        ? null
        : 'needs turn, radius > 0, angle 90|180, bank (radians)'
    default:
      return `unknown segment type ${String(o.type)}`
  }
}
