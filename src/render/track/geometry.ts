// Track mesh generation from the shared schema. Pure TypeScript (no three) so it
// is unit-testable in Node; src/render/track/mesh.ts wraps the arrays for three.js.
import { bankRise } from '../../track/bank'
import { loopPoint, poses, ROAD_WIDTH, sampleSegment, segmentLength, turnSign, type LoopSegment, type Sample } from '../../track/pose'
import type { Pose, Segment, Track } from '../../track/schema'

export { sampleSegment, segmentLength, type Sample } from '../../track/pose'

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
export const lateralPoint = (p: Sample, u: number, s: number): [number, number, number] => [
  p.x + Math.cos(p.heading) * u,
  p.y + SURFACE_LIFT + bankRise(p.roll, -s * u),
  p.z - Math.sin(p.heading) * u,
]

/** Rows to sample: about one every 1.5 m, never fewer than 13. Surface patches follow the same rows (zones.ts). */
export const rowCount = (seg: Segment): number => Math.max(12, Math.ceil(segmentLength(seg) / 1.5)) + 1

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

/** Road height above which a row counts as raised and gets a body or a deck underneath. */
export const RAISED_MIN = 0.05
/** Height a road below needs under a raised row before that row has to stay open: a car plus the deck. */
export const SPAN_HEADROOM = 2
/** A lower road this close (centreline to centreline) to a raised row keeps that row an open bridge span. */
export const SPAN_CLEAR = TRACK_WIDTH + 1
/** Lap distance within which a lower road is the piece's own approach (a ramp's foot), not a road underneath. */
export const SPAN_PATH_SKIP = 50
/** Thickness of an elevated deck's concrete box under the road, on a bridge span. */
export const DECK_DEPTH = 1

/** How a raised row stands: `fill` is a solid body down to the ground, `span` a deck box over a road below. */
export type BodyKind = 'fill' | 'span'

/**
 * Per geometry row (rowCount) of one segment: `fill` or `span`. `caps` are the filled rows
 * that close a filled run — the next or previous row along the lap, across segment joints,
 * is not filled (a span, a gap, a loop or ground-level road) — so the body has an end face.
 */
export type BodyPlan = { kinds: BodyKind[]; caps: number[] }

const lapGap = (a: number, b: number, lap: number): number => {
  const d = Math.abs(a - b) % lap
  return Math.min(d, lap - d)
}

/**
 * Which rows of the lap stand on a solid body and which stay open over a road passing
 * underneath (crossover's bridge over the start straight). Null for a segment with no raised
 * row, a gap (no road) and a loop (its own shell and foot). Visual only: physics never sees it.
 */
export const planBodies = (track: Track): (BodyPlan | null)[] => {
  const ps = poses(track)
  const road: (Sample & { s: number })[] = []
  const starts: number[] = []
  let at = 0
  track.segments.forEach((seg, i) => {
    starts.push(at)
    const len = segmentLength(seg)
    if (seg.type !== 'gap') {
      const n = Math.max(1, Math.ceil(len / 1.5))
      for (let k = 0; k <= n; k++) road.push({ ...sampleSegment(ps[i], seg, k / n), s: at + (len * k) / n })
    }
    at += len
  })
  const lap = at
  const kinds = track.segments.map((seg, i): BodyKind[] | null => {
    if (seg.type === 'gap' || seg.type === 'loop') return null
    const rows = rowCount(seg)
    const len = segmentLength(seg)
    let raised = false
    const out = Array.from({ length: rows }, (_, r): BodyKind => {
      const t = r / (rows - 1)
      const p = sampleSegment(ps[i], seg, t)
      if (p.y > RAISED_MIN) raised = true
      const s = starts[i] + len * t
      const under = road.some((q) => q.y < p.y - SPAN_HEADROOM && Math.hypot(q.x - p.x, q.z - p.z) < SPAN_CLEAR && lapGap(q.s, s, lap) > SPAN_PATH_SKIP)
      return under ? 'span' : 'fill'
    })
    return raised ? out : null
  })
  const n = track.segments.length
  return kinds.map((k, i) => {
    if (!k) return null
    const prev = kinds[(i - 1 + n) % n]
    const next = kinds[(i + 1) % n]
    const caps: number[] = []
    k.forEach((kind, r) => {
      if (kind !== 'fill') return
      const before = r > 0 ? k[r - 1] : prev ? prev[prev.length - 1] : null
      const after = r < k.length - 1 ? k[r + 1] : next ? next[0] : null
      if (before !== 'fill' || after !== 'fill') caps.push(r)
    })
    return { kinds: k, caps }
  })
}

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
 * (buildDeck). Rows: left top, left foot, right top, right foot; cap vertices follow the rows.
 */
export const buildBody = (entry: Pose, seg: Segment, plan: BodyPlan): SegmentGeometry => {
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const half = TRACK_WIDTH / 2
  const perRow = 4
  const pos: number[] = []
  const samples = Array.from({ length: rows }, (_, r) => sampleSegment(entry, seg, r / (rows - 1)))
  for (const p of samples) {
    for (const u of [half, -half]) {
      const [x, y, z] = wallTop(p, seg, u, s)
      pos.push(x, y, z, x, 0, z)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    if (plan.kinds[r] !== 'fill' || plan.kinds[r + 1] !== 'fill') continue
    const a = r * perRow
    const b = (r + 1) * perRow
    idx.push(a, a + 1, b, a + 1, b + 1, b) // left wall
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3) // right wall
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

/**
 * Visual-only box section under a raised segment's span rows (a bridge over a road below): a
 * skirt down DECK_DEPTH from each road edge and a soffit joining them, between a span row and
 * its neighbours, so the deck runs into the abutment caps (buildBody) at both ends. A loop gets
 * its shell instead. Returns null when no row is a span. Rows: left top, left foot, right top,
 * right foot.
 */
export const buildDeck = (entry: Pose, seg: Segment, kinds: readonly BodyKind[] | null): SegmentGeometry | null => {
  if (seg.type === 'loop') return buildLoopShell(entry, seg)
  if (!kinds || !kinds.includes('span')) return null
  const rows = rowCount(seg)
  const s = turnSign(seg)
  const half = TRACK_WIDTH / 2
  const perRow = 4
  const positions = new Float32Array(rows * perRow * 3)
  for (let r = 0; r < rows; r++) {
    const p = sampleSegment(entry, seg, r / (rows - 1))
    for (const [k, u] of [[0, half], [2, -half]]) {
      const [x, y, z] = lateralPoint(p, u, s)
      positions.set([x, y, z], (r * perRow + k) * 3)
      positions.set([x, y - DECK_DEPTH, z], (r * perRow + k + 1) * 3)
    }
  }
  const idx: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    if (kinds[r] !== 'span' && kinds[r + 1] !== 'span') continue
    const a = r * perRow
    const b = (r + 1) * perRow
    idx.push(a, a + 1, b, a + 1, b + 1, b) // left skirt
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3) // right skirt
    idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3) // soffit, wound to face down so it lights from below
  }
  return { positions, indices: new Uint32Array(idx), rows, perRow }
}

/**
 * A loop's outside: the same box section as buildDeck — a skirt DECK_DEPTH deep from each road edge
 * and a shell joining them — wrapped round the loop, so from beside or below it reads as a solid
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

/** Spacing of the pillars under a deck, and the clearance they keep from any road below. */
export const DECK_PILLAR_STEP = 12
export const DECK_PILLAR_CLEAR = TRACK_WIDTH / 2 + 2

/** A deck pillar: centred on (x, z), standing on the ground, reaching up to `top`. */
export type DeckPillar = { x: number; z: number; top: number }

/**
 * Pillars under the centreline of every bridge span (span rows, buildDeck), one every
 * DECK_PILLAR_STEP metres. A pillar that would stand on another part of the lap (an underpass)
 * is left out, so the road below stays open; filled rows stand on their own body.
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
  const out: DeckPillar[] = []
  track.segments.forEach((seg, i) => {
    const kinds = plans[i]?.kinds
    if (!kinds) return // a loop stands on its own foot; gaps and ground-level road need none
    const len = segmentLength(seg)
    for (let d = DECK_PILLAR_STEP / 2; d < len; d += DECK_PILLAR_STEP) {
      if (kinds[Math.round((d / len) * (kinds.length - 1))] !== 'span') continue
      const p = sampleSegment(ps[i], seg, d / len)
      const top = p.y - DECK_DEPTH
      const blocked = road.some((q) => q.y < top - 1 && Math.hypot(q.x - p.x, q.z - p.z) < DECK_PILLAR_CLEAR)
      if (!blocked) out.push({ x: p.x, z: p.z, top })
    }
  })
  return out
}
