// Track mesh generation from the shared schema. Pure TypeScript (no three) so it
// is unit-testable in Node; src/render/track/mesh.ts wraps the arrays for three.js.
import { bankAngleAt, bankRise } from '../../track/bank'
import { poses, type Pose, type Segment, type Track } from '../../track/schema'

/** Road width in metres. */
export const TRACK_WIDTH = 10 // matches the Kenney road pieces
/**
 * Lift of the procedural surface above the schema pose. Zero: it must sit exactly at the
 * Kenney pieces' height, or the step at every glb/procedural joint draws a dark seam line.
 * The ground can never z-fight it (drawn first, no depth writes: scene.ts).
 */
export const SURFACE_LIFT = 0

/** A point on a segment's centerline: world position, heading and road roll (radians). */
export type Sample = { x: number; y: number; z: number; heading: number; roll: number }

export type SegmentGeometry = {
  positions: Float32Array // xyz triples
  indices: Uint32Array // triangle list
  rows: number // centerline samples; first row = entry edge, last row = exit edge
  perRow: number // vertices per row: surface columns + 2 curb tops
}


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
        // Linear, exactly the planar strip physics drives on (src/physics/surface.ts): no bump at the foot.
        y: entry.y + dy * t,
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
      // Eased bank angle, shared with physics (src/track/bank.ts).
      const roll = seg.type === 'banked' ? bankAngleAt(seg.bank, t) : 0
      return { x: cx - Math.cos(heading) * r * s, y: entry.y, z: cz + Math.sin(heading) * r * s, heading, roll }
    }
  }
}

/**
 * Road point at lateral offset u (metres, positive = left of travel) on turn side s.
 * Positive roll raises the outside of the turn about the centreline — the same bankRise()
 * src/physics/surface.ts drives on, so the visible road and the collider agree.
 */
export const lateralPoint = (p: Sample, u: number, s: number): [number, number, number] => [
  p.x + Math.cos(p.heading) * u,
  p.y + SURFACE_LIFT + bankRise(p.roll, -s * u),
  p.z - Math.sin(p.heading) * u,
]

/** Rows to sample: about one every 1.5 m, never fewer than 13. */
const rowCount = (seg: Segment): number => Math.max(12, Math.ceil(segmentLength(seg) / 1.5)) + 1

/** Surface bands of the road cross-section; mesh.ts colours each band to match the Kenney pieces. */
export type Band = 'grass' | 'curb' | 'road'

/**
 * Cross-section, left edge to right edge: (lateral offset m, height m, band). It copies the
 * Kenney straight (assets/pieces/straight.glb): 6.9 m of road at y 0.1, grey curbs out to
 * ±4.18 m raised to 0.2, grass shoulders out to ±5 m at y 0 — so procedural segments and
 * glb pieces meet with the same road, curbs and edges. Repeated offsets make crisp steps.
 */
export const PROFILE: readonly [number, number, Band][] = [
  [5, 0, 'grass'],
  [4.18, 0, 'grass'],
  [4.18, 0.2, 'curb'],
  [3.45, 0.2, 'curb'],
  [3.45, 0.1, 'road'],
  [1.725, 0.1, 'road'],
  [0, 0.1, 'road'],
  [-1.725, 0.1, 'road'],
  [-3.45, 0.1, 'road'],
  [-3.45, 0.2, 'curb'],
  [-4.18, 0.2, 'curb'],
  [-4.18, 0, 'grass'],
  [-5, 0, 'grass'],
]
/** Index of the centreline column in PROFILE. */
export const CENTRE_COLUMN = PROFILE.findIndex(([u]) => u === 0)

export const buildSegment = (entry: Pose, seg: Segment): SegmentGeometry => {
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const perRow = PROFILE.length
  const positions = new Float32Array(rows * perRow * 3)
  for (let r = 0; r < rows; r++) {
    const p = sampleSegment(entry, seg, r / (rows - 1))
    PROFILE.forEach(([u, h], c) => {
      const [x, y, z] = lateralPoint(p, u, s)
      positions.set([x, y + h, z], (r * perRow + c) * 3)
    })
  }

  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, b, d, c) // counter-clockwise from above
  for (let r = 0; r < rows - 1; r++) {
    const a = r * perRow
    const b = (r + 1) * perRow
    for (let c = 0; c < perRow - 1; c++) quad(a + c, a + c + 1, b + c, b + c + 1)
  }
  return { positions, indices: new Uint32Array(idx), rows, perRow }
}

/** Geometry for every segment of a track, each placed at its poses() entry. */
export const buildTrack = (track: Track): SegmentGeometry[] => {
  const ps = poses(track)
  return track.segments.map((seg, i) => buildSegment(ps[i], seg))
}

/** Centerline point of a geometry row (the road surface, PROFILE height included). */
export const rowCenter = (g: SegmentGeometry, row: number): [number, number, number] => {
  const i = (row * g.perRow + CENTRE_COLUMN) * 3
  return [g.positions[i], g.positions[i + 1], g.positions[i + 2]]
}

/** Apron run per metre of dip: a 1:2 slope from the dipped inner edge back up to the road plane. */
export const APRON_RUN = 2

/**
 * Visual-only verge for a banked segment: an apron from the (dipped) inner road edge up to
 * the road plane, as wide as APRON_RUN × the dip (so zero at both flat joints and never
 * poking past the neighbouring segments), and a skirt from the (raised) outer edge down to
 * the road plane. Physics never sees it. Returns null for non-banked segments.
 */
export const buildApron = (entry: Pose, seg: Segment): SegmentGeometry | null => {
  if (seg.type !== 'banked') return null
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const half = TRACK_WIDTH / 2
  const perRow = 4 // inner edge, apron rim, outer edge, skirt foot
  const positions = new Float32Array(rows * perRow * 3)
  for (let r = 0; r < rows; r++) {
    const p = sampleSegment(entry, seg, r / (rows - 1))
    const inner = lateralPoint(p, s * half, s) // the inner side is toward the turn centre
    const dip = Math.max(0, p.y + SURFACE_LIFT - inner[1])
    const rim = lateralPoint({ ...p, roll: 0 }, s * (half + APRON_RUN * dip), s)
    const outer = lateralPoint(p, -s * half, s)
    positions.set(inner, r * perRow * 3)
    positions.set(rim, (r * perRow + 1) * 3)
    positions.set(outer, (r * perRow + 2) * 3)
    positions.set([outer[0], p.y + SURFACE_LIFT, outer[2]], (r * perRow + 3) * 3)
  }
  const idx: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    const a = r * perRow
    const b = (r + 1) * perRow
    idx.push(a, a + 1, b, a + 1, b + 1, b) // apron
    idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2) // outer skirt
  }
  return { positions, indices: new Uint32Array(idx), rows, perRow }
}

/**
 * Visual-only solid sides under a ramp or drop: a wall down to the ground along each outer
 * edge, so an elevated ramp reads as a solid block instead of a floating plank. Returns null
 * for every other segment type.
 */
export const buildRampSupport = (entry: Pose, seg: Segment): SegmentGeometry | null => {
  if (seg.type !== 'ramp' && seg.type !== 'drop') return null
  const rows = rowCount(seg)
  const half = TRACK_WIDTH / 2
  const perRow = 4 // left top, left foot, right top, right foot
  const positions = new Float32Array(rows * perRow * 3)
  for (let r = 0; r < rows; r++) {
    const p = sampleSegment(entry, seg, r / (rows - 1))
    for (const [k, u] of [[0, half], [2, -half]]) {
      const [x, y, z] = lateralPoint(p, u, 1)
      positions.set([x, y, z], (r * perRow + k) * 3)
      positions.set([x, 0, z], (r * perRow + k + 1) * 3)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    const a = r * perRow
    const b = (r + 1) * perRow
    idx.push(a, a + 1, b, a + 1, b + 1, b) // left wall
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3) // right wall
  }
  return { positions, indices: new Uint32Array(idx), rows, perRow }
}
