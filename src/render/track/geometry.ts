// Track mesh generation from the shared schema. Pure TypeScript (no three) so it
// is unit-testable in Node; src/render/track/mesh.ts wraps the arrays for three.js.
import { planBodies, roadPoint, rowCount, type BodyKind, type BodyPlan } from '../../track/bodies'
import { loopPoint, poses, ROAD_WIDTH, sampleSegment, segmentLength, turnSign, type LoopSegment, type Sample } from '../../track/pose'
import type { Pose, Segment, Track } from '../../track/schema'

export { sampleSegment, segmentLength, type Sample } from '../../track/pose'
export { BRIDGE_MIN_HEIGHT, planBodies, RAISED_MIN, rowCount, SPAN_CLEAR, SPAN_HEADROOM, SPAN_PATH_SKIP, type BodyKind, type BodyPlan } from '../../track/bodies'

/** Road width in metres (ROAD_WIDTH, src/track/pose.ts). */
export const TRACK_WIDTH = ROAD_WIDTH
/**
 * Lift of the procedural surface above the schema pose. Zero: it must sit exactly at the
 * Kenney pieces' height, or the step at every glb/procedural joint draws a dark seam line.
 * The ground can never z-fight it (drawn first, no depth writes: scene.ts).
 */
export const SURFACE_LIFT = 0

export type SegmentGeometry = {
  positions: Float32Array // xyz triples
  indices: Uint32Array // triangle list
  rows: number // centerline samples; first row = entry edge, last row = exit edge
  perRow: number // vertices per row: surface columns + 2 curb tops
}

/**
 * Road point at lateral offset u (metres, positive = left of travel) on turn side s.
 * Positive roll raises the outside of the turn about the centreline — the same bankRise()
 * src/physics/surface.ts drives on, so the visible road and the collider agree.
 */
export const lateralPoint = (p: Sample, u: number, s: number): [number, number, number] => {
  const [x, y, z] = roadPoint(p, u, s)
  return [x, y + SURFACE_LIFT, z]
}

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

// Road point on a loop: loopPoint (the shape physics raycasts), lifted `h` along its inward normal.
const loopVertex = (entry: Pose, seg: LoopSegment, row: number, rows: number, u: number, h: number): [number, number, number] => {
  const q = loopPoint(entry, seg, (2 * Math.PI * row) / (rows - 1), u)
  return [q.x + q.nx * h, q.y + q.ny * h, q.z + q.nz * h]
}

export const buildSegment = (entry: Pose, seg: Segment): SegmentGeometry => {
  const rows = rowCount(seg)
  if (seg.type === 'loop') {
    // The same cross-section and winding as below, wrapped round the loop: it faces the loop's axis.
    const perRow = PROFILE.length
    const positions = new Float32Array(rows * perRow * 3)
    for (let r = 0; r < rows; r++) PROFILE.forEach(([u, h], c) => positions.set(loopVertex(entry, seg, r, rows, u, SURFACE_LIFT + h), (r * perRow + c) * 3))
    return { positions, indices: gridIndices(rows, perRow), rows, perRow }
  }
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

  return { positions, indices: gridIndices(rows, perRow), rows, perRow }
}

// Triangles of a rows × perRow road grid, counter-clockwise from above (from the axis, on a loop).
const gridIndices = (rows: number, perRow: number): Uint32Array => {
  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, b, d, c)
  for (let r = 0; r < rows - 1; r++) {
    const a = r * perRow
    const b = (r + 1) * perRow
    for (let c = 0; c < perRow - 1; c++) quad(a + c, a + c + 1, b + c, b + c + 1)
  }
  return new Uint32Array(idx)
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

/** Thickness of an elevated deck's concrete box under the road, on a bridge span. */
export const DECK_DEPTH = 1
/** A bridge's parapet either side of the road: thickness outward from the road edge, and height above it. */
export const PARAPET_WIDTH = 0.5
export const PARAPET_HEIGHT = 0.8

/** Depth of a filled body's lid below the road edges: under the road, so the road always draws over it. */
export const LID_DROP = 0.05

// Top of a body's side wall: the road edge, or on a banked turn's inner side the apron rim, so the apron sits on the body.
const wallTop = (p: Sample, seg: Segment, u: number, s: number): [number, number, number] => {
  if (seg.type !== 'banked' || Math.sign(u) !== s) return lateralPoint(p, u, s)
  const inner = lateralPoint(p, u, s)
  const dip = Math.max(0, p.y + SURFACE_LIFT - inner[1])
  return dip > 0 ? lateralPoint({ ...p, roll: 0 }, u + s * APRON_RUN * dip, s) : inner
}

/**
 * Visual-only solid body under a raised segment's filled rows: a wall from each road edge down
 * to the ground (y 0) between consecutive filled rows, and at every cap row an end face shaped
 * like the road's cross-section (PROFILE) down to the ground, so a ramp, drop or raised road
 * reads as one solid block from beside, below and either end. Span rows get nothing here
 * (buildDeck). A lid LID_DROP under the road joins the two walls, so the body is closed on
 * every side and a camera inside it sees concrete, not the underside of the road. Rows: left
 * top, left foot, right top, right foot, left lid, right lid; cap vertices follow the rows.
 */
export const buildBody = (entry: Pose, seg: Segment, plan: BodyPlan): SegmentGeometry => {
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const half = TRACK_WIDTH / 2
  const perRow = 6
  const pos: number[] = []
  const samples = Array.from({ length: rows }, (_, r) => sampleSegment(entry, seg, r / (rows - 1)))
  for (const p of samples) {
    for (const u of [half, -half]) {
      const [x, y, z] = wallTop(p, seg, u, s)
      pos.push(x, y, z, x, 0, z)
    }
    // The lid follows the road edges (the banked plane), below every PROFILE height.
    for (const u of [half, -half]) {
      const [x, y, z] = lateralPoint(p, u, s)
      pos.push(x, Math.max(0, y - LID_DROP), z)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    if (plan.kinds[r] !== 'fill' || plan.kinds[r + 1] !== 'fill') continue
    const a = r * perRow
    const b = (r + 1) * perRow
    idx.push(a, a + 1, b, a + 1, b + 1, b) // left wall
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3) // right wall
    idx.push(a + 4, b + 4, a + 5, a + 5, b + 4, b + 5) // lid
  }
  for (const r of plan.caps) {
    const p = samples[r]
    const tops: [number, number, number][] = PROFILE.map(([u, h]) => {
      const [x, y, z] = lateralPoint(p, u, s)
      return [x, y + h, z]
    })
    // A banked turn's apron rim is the body's inner edge: close the cap out to it.
    const rimTop = wallTop(p, seg, s * half, s)
    if (s > 0) tops.unshift(rimTop)
    else tops.push(rimTop)
    const base = pos.length / 3
    for (const [x, y, z] of tops) pos.push(x, y, z, x, 0, z)
    for (let c = 0; c < tops.length - 1; c++) {
      const a = base + 2 * c
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), rows, perRow }
}

// A bridge deck's cross-section, left to right, as (lateral offset, height above the road edge):
// the left parapet's inner foot and top, its outer top, the deck's outer foot, then the same
// mirrored on the right. The lid back to the first column closes it in the road edges' plane, under
// the curbs and the road (supportMaterial is pushed back in depth, so the road draws over it).
const DECK_SECTION: readonly [number, number][] = (() => {
  const half = TRACK_WIDTH / 2
  const out = half + PARAPET_WIDTH
  return [
    [half, 0],
    [half, PARAPET_HEIGHT],
    [out, PARAPET_HEIGHT],
    [out, -DECK_DEPTH],
    [-out, -DECK_DEPTH],
    [-out, PARAPET_HEIGHT],
    [-half, PARAPET_HEIGHT],
    [-half, 0],
  ]
})()
/** Vertices per row of a bridge deck (DECK_SECTION). */
export const DECK_PER_ROW = DECK_SECTION.length
/** DECK_SECTION columns at the deck's foot (soffit corners), for the darker concrete. */
export const DECK_FOOT_COLUMNS: readonly number[] = [3, 4]

/**
 * Visual-only bridge deck under a raised segment's span rows: a closed concrete box DECK_DEPTH deep
 * under the road, with a parapet PARAPET_WIDTH thick and PARAPET_HEIGHT tall along each road edge
 * (DECK_SECTION), drawn between a span row and its neighbours so it runs into the abutment caps
 * (buildBody). The lid under the road and an end face at both ends of every stretch close the
 * box, so it is solid from every side and never a free-edged sheet. Open underneath: the pillars
 * (planDeckPillars) carry it. A loop gets its shell instead. Returns null when no row is a span.
 */
export const buildDeck = (entry: Pose, seg: Segment, kinds: readonly BodyKind[] | null): SegmentGeometry | null => {
  if (seg.type === 'loop') return buildLoopShell(entry, seg)
  if (!kinds || !kinds.includes('span')) return null
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const perRow = DECK_PER_ROW
  const pos: number[] = []
  for (let r = 0; r < rows; r++) {
    const p = sampleSegment(entry, seg, r / (rows - 1))
    for (const [u, h] of DECK_SECTION) {
      // The parapet and the deck sides follow the road's bank, extended past its edge.
      const [x, y, z] = lateralPoint(p, u, s)
      pos.push(x, y + h, z)
    }
  }
  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, b, d, c)
  const drawn = (r: number) => kinds[r] === 'span' || kinds[r + 1] === 'span'
  for (let r = 0; r < rows - 1; r++) {
    if (!drawn(r)) continue
    const a = r * perRow
    const b = (r + 1) * perRow
    // Around the section, wound so each face looks out of the box.
    for (let c = 0; c < perRow; c++) {
      const d = (c + 1) % perRow
      quad(a + c, b + c, a + d, b + d)
    }
  }
  // End faces: the section as three rectangles (left parapet, deck box, right parapet).
  const endFace = (r: number, flip: boolean) => {
    const v = (c: number) => r * perRow + c
    const tri = (a: number, b: number, c: number) => (flip ? idx.push(a, c, b) : idx.push(a, b, c))
    const rect = (a: number, b: number, c: number, d: number) => {
      tri(a, b, c)
      tri(a, c, d)
    }
    rect(v(0), v(1), v(2), v(3)) // left parapet down to the deck foot
    rect(v(0), v(3), v(4), v(7)) // the deck box between the road edges
    rect(v(7), v(4), v(5), v(6)) // right parapet
  }
  for (let r = 0; r < rows - 1; r++) {
    if (!drawn(r)) continue
    if (r === 0 || !drawn(r - 1)) endFace(r, false)
    if (r === rows - 2 || !drawn(r + 1)) endFace(r + 1, true)
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), rows, perRow }
}

/**
 * A loop's outside: a box section like buildDeck's without the parapets — a skirt DECK_DEPTH deep
 * from each road edge and a shell joining them — wrapped round the loop, so from beside or below it reads as a solid
 * ribbon and not as the back of a road. Rows: left top, left foot, right top, right foot.
 */
const buildLoopShell = (entry: Pose, seg: LoopSegment): SegmentGeometry => {
  const rows = rowCount(seg)
  const half = TRACK_WIDTH / 2
  const perRow = 4
  const positions = new Float32Array(rows * perRow * 3)
  for (let r = 0; r < rows; r++) {
    for (const [k, u] of [[0, half], [2, -half]]) {
      positions.set(loopVertex(entry, seg, r, rows, u, SURFACE_LIFT), (r * perRow + k) * 3)
      positions.set(loopVertex(entry, seg, r, rows, u, SURFACE_LIFT - DECK_DEPTH), (r * perRow + k + 1) * 3)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    const a = r * perRow
    const b = (r + 1) * perRow
    idx.push(a, a + 1, b, a + 1, b + 1, b)
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3)
    idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3) // shell, facing away from the axis
  }
  return { positions, indices: new Uint32Array(idx), rows, perRow }
}

/** Target spacing of the pillars under a bridge, and the clearance they keep from any road below. */
export const DECK_PILLAR_STEP = 12
export const DECK_PILLAR_CLEAR = TRACK_WIDTH / 2 + 2

/** A deck pillar: centred on (x, z), standing on the ground, reaching up to `top`. */
export type DeckPillar = { x: number; z: number; top: number }

/**
 * Pillars under the centreline of every bridge (span rows, buildDeck). Each run of span rows along
 * the lap, across segment joints, gets evenly spaced pillars about DECK_PILLAR_STEP apart and at
 * least one, however short the run. A pillar that would stand on another part of the lap (an
 * underpass) is left out, so the road below stays open; filled rows stand on their own body.
 */
export const planDeckPillars = (track: Track): DeckPillar[] => {
  const ps = poses(track)
  const road: Sample[] = []
  track.segments.forEach((seg, i) => {
    if (seg.type === 'gap') return
    const n = Math.max(1, Math.ceil(segmentLength(seg) / 1.5))
    for (let k = 0; k <= n; k++) road.push(sampleSegment(ps[i], seg, k / n))
  })
  const plans = planBodies(track)
  // Every geometry row in lap order: a span row, or null for anything that breaks a run.
  type SpanRow = { seg: number; t: number; s: number }
  const rows: (SpanRow | null)[] = []
  let at = 0
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    const kinds = plans[i]?.kinds
    if (!kinds) rows.push(null) // a loop stands on its own foot; gaps and ground-level road need none
    else kinds.forEach((k, r) => rows.push(k === 'span' ? { seg: i, t: r / (kinds.length - 1), s: at + (len * r) / (kinds.length - 1) } : null))
    at += len
  })
  const runs: SpanRow[][] = []
  let run: SpanRow[] = []
  for (const row of rows) {
    if (row) run.push(row)
    else if (run.length > 0) runs.push(run), (run = [])
  }
  if (run.length > 0) {
    // A run across the lap's start continues into the first run.
    if (rows[0] && runs.length > 0) runs[0] = [...run, ...runs[0].map((r) => ({ ...r, s: r.s + at }))]
    else runs.push(run)
  }
  const out: DeckPillar[] = []
  for (const r of runs) {
    const s0 = r[0].s
    const len = r[r.length - 1].s - s0
    const count = Math.max(1, Math.round(len / DECK_PILLAR_STEP))
    for (let k = 0; k < count; k++) {
      const want = s0 + ((k + 0.5) * len) / count
      const near = r.reduce((best, row) => (Math.abs(row.s - want) < Math.abs(best.s - want) ? row : best))
      const p = sampleSegment(ps[near.seg], track.segments[near.seg], near.t)
      const top = p.y - DECK_DEPTH
      const blocked = road.some((q) => q.y < top - 1 && Math.hypot(q.x - p.x, q.z - p.z) < DECK_PILLAR_CLEAR)
      if (!blocked) out.push({ x: p.x, z: p.z, top })
    }
  }
  return out
}
