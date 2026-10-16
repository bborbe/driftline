// Track mesh generation from the shared schema. Pure TypeScript (no three) so it
// is unit-testable in Node; src/render/track/mesh.ts wraps the arrays for three.js.
import { poses, type Pose, type Segment, type Track } from '../../track/schema'

/** Road width in metres. */
export const TRACK_WIDTH = 12
/** Curb height on both road edges, in metres. */
export const CURB_HEIGHT = 0.3
/** Road surface sits this far above the ground plane to avoid z-fighting. */
export const SURFACE_LIFT = 0.02
/** Lateral subdivisions of the road surface. */
const COLUMNS = 6
/** Fraction of a banked segment spent rolling in (and out again). */
const BANK_EASE = 0.2

/** A point on a segment's centerline: world position, heading and road roll (radians). */
export type Sample = { x: number; y: number; z: number; heading: number; roll: number }

export type SegmentGeometry = {
  positions: Float32Array // xyz triples
  indices: Uint32Array // triangle list
  rows: number // centerline samples; first row = entry edge, last row = exit edge
  perRow: number // vertices per row: surface columns + 2 curb tops
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t)

const turnSign = (seg: Segment): number => ('turn' in seg && seg.turn === 'right' ? -1 : 1)

/** Arc angle (radians) for curved segments, 0 for straight-line ones. */
const arcAngle = (seg: Segment): number => {
  switch (seg.type) {
    case 'curve':
    case 'banked':
      return (seg.angle * Math.PI) / 180
    case 'hairpin':
      return Math.PI
    default:
      return 0
  }
}

/** Centerline length in metres. */
export const segmentLength = (seg: Segment): number => {
  switch (seg.type) {
    case 'straight':
    case 'ramp':
    case 'drop':
      return seg.length
    default:
      return seg.radius * arcAngle(seg)
  }
}

/** Sample a segment's centerline at t in [0, 1]; t = 0 is the entry pose, t = 1 the exit pose. */
export const sampleSegment = (entry: Pose, seg: Segment, t: number): Sample => {
  switch (seg.type) {
    case 'straight':
    case 'ramp':
    case 'drop': {
      const dy = seg.type === 'ramp' ? seg.rise : seg.type === 'drop' ? -seg.fall : 0
      const d = seg.length * t
      return {
        x: entry.x + Math.sin(entry.heading) * d,
        y: entry.y + dy * smoothstep(t),
        z: entry.z + Math.cos(entry.heading) * d,
        heading: entry.heading,
        roll: 0,
      }
    }
    default: {
      // Same arc construction as schema.ts so the exit edge meets poses() exactly.
      const s = turnSign(seg)
      const r = seg.radius
      const cx = entry.x + Math.cos(entry.heading) * r * s
      const cz = entry.z - Math.sin(entry.heading) * r * s
      const heading = entry.heading + s * arcAngle(seg) * t
      let roll = 0
      if (seg.type === 'banked') {
        const ease = Math.min(t, 1 - t) / BANK_EASE
        roll = seg.bank * smoothstep(Math.min(1, Math.max(0, ease)))
      }
      return { x: cx - Math.cos(heading) * r * s, y: entry.y, z: cz + Math.sin(heading) * r * s, heading, roll }
    }
  }
}

/**
 * Road point at lateral offset u (metres, positive = left of travel) on turn side s.
 * Positive roll raises the outside of the turn.
 */
export const lateralPoint = (p: Sample, u: number, s: number): [number, number, number] => {
  const h = u * Math.cos(p.roll)
  return [p.x + Math.cos(p.heading) * h, p.y + SURFACE_LIFT - s * u * Math.sin(p.roll), p.z - Math.sin(p.heading) * h]
}

/** Rows to sample: about one every 1.5 m, never fewer than 13. */
const rowCount = (seg: Segment): number => Math.max(12, Math.ceil(segmentLength(seg) / 1.5)) + 1

export const buildSegment = (entry: Pose, seg: Segment): SegmentGeometry => {
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const half = TRACK_WIDTH / 2
  const perRow = COLUMNS + 3 // COLUMNS + 1 surface vertices, then left and right curb tops
  const positions = new Float32Array(rows * perRow * 3)
  for (let r = 0; r < rows; r++) {
    const p = sampleSegment(entry, seg, r / (rows - 1))
    for (let c = 0; c <= COLUMNS; c++) {
      positions.set(lateralPoint(p, half - (TRACK_WIDTH * c) / COLUMNS, s), (r * perRow + c) * 3)
    }
    const left = lateralPoint(p, half, s)
    const right = lateralPoint(p, -half, s)
    positions.set([left[0], left[1] + CURB_HEIGHT, left[2]], (r * perRow + COLUMNS + 1) * 3)
    positions.set([right[0], right[1] + CURB_HEIGHT, right[2]], (r * perRow + COLUMNS + 2) * 3)
  }

  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, b, d, c) // counter-clockwise from above
  for (let r = 0; r < rows - 1; r++) {
    const a = r * perRow
    const b = (r + 1) * perRow
    for (let c = 0; c < COLUMNS; c++) quad(a + c, a + c + 1, b + c, b + c + 1)
    quad(a + COLUMNS + 1, a, b + COLUMNS + 1, b) // left curb face
    quad(a + COLUMNS, a + COLUMNS + 2, b + COLUMNS, b + COLUMNS + 2) // right curb face
  }
  return { positions, indices: new Uint32Array(idx), rows, perRow }
}

/** Geometry for every segment of a track, each placed at its poses() entry. */
export const buildTrack = (track: Track): SegmentGeometry[] => {
  const ps = poses(track)
  return track.segments.map((seg, i) => buildSegment(ps[i], seg))
}

/** Centerline point of a geometry row (middle surface vertex). */
export const rowCenter = (g: SegmentGeometry, row: number): [number, number, number] => {
  const i = (row * g.perRow + COLUMNS / 2) * 3
  return [g.positions[i], g.positions[i + 1], g.positions[i + 2]]
}
