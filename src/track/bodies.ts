// Filled bodies under raised road: which rows of a raised segment stand on a solid body down
// to the ground and which stay an open bridge span, and the body's collider boxes. The single
// source for the body mesh (src/render/track/geometry.ts buildBody) and its collider
// (src/physics/surface.ts). Pure TypeScript: no three, no browser APIs.
import { bankRise } from './bank'
import { poses, ROAD_WIDTH, sampleSegment, segmentLength, turnSign, type Sample } from './pose'
import type { Pillar, Segment, Track } from './schema'

/** Rows to sample: about one every 1.5 m, never fewer than 13. Surface patches follow the same rows (zones.ts). */
export const rowCount = (seg: Segment): number => Math.max(12, Math.ceil(segmentLength(seg) / 1.5)) + 1

/**
 * Road point at lateral offset u (metres, positive = left of travel) on turn side s, with no
 * render lift. Positive roll raises the outside of the turn about the centreline — the same
 * bankRise() src/physics/surface.ts drives on.
 */
export const roadPoint = (p: Sample, u: number, s: number): [number, number, number] => [
  p.x + Math.cos(p.heading) * u,
  p.y + bankRise(p.roll, -s * u),
  p.z - Math.sin(p.heading) * u,
]

/** Road height above which a row counts as raised and gets a body or a deck underneath. */
export const RAISED_MIN = 0.05
/** Height a road below needs under a raised row before that row has to stay open: a car plus the deck. */
export const SPAN_HEADROOM = 2
/** A lower road this close (centreline to centreline) to a raised row keeps that row an open bridge span. */
export const SPAN_CLEAR = ROAD_WIDTH + 1
/** Lap distance within which a lower road is the piece's own approach (a ramp's foot), not a road underneath. */
export const SPAN_PATH_SKIP = 50
/** Road height above the ground (y 0) from which a raised row is an open bridge, not a filled embankment. */
export const BRIDGE_MIN_HEIGHT = 3

/** How a raised row stands: `fill` is a solid body down to the ground, `span` an open bridge deck on pillars. */
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
 * Which rows of the lap stand on a solid body (an embankment) and which are an open bridge: a
 * row whose road is BRIDGE_MIN_HEIGHT or more above the ground, or one with a road passing
 * underneath (crossover's bridge over the start straight). Null for a segment with no raised
 * row, a gap (no road) and a loop (its own shell and foot).
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
      return under || p.y >= BRIDGE_MIN_HEIGHT ? 'span' : 'fill'
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

/**
 * The filled bodies as solid upright boxes, one between each pair of consecutive filled rows:
 * as wide as the road, as long as the longer road edge between the rows (so a curve's outer
 * wall has no gap), standing on the ground up to the lower road edge of the pair. A car on the
 * road above clears the top; a car beside or under the road hits the side walls, and the first
 * and last box of a run are its end caps. Boxes no higher than RAISED_MIN (a ramp's foot) are
 * left out. Spans get none: the road below a bridge stays open.
 */
export const bodyBoxes = (track: Track): Pillar[] => {
  const ps = poses(track)
  const half = ROAD_WIDTH / 2
  return planBodies(track).flatMap((plan, i) => {
    if (!plan) return []
    const seg = track.segments[i]
    const s = turnSign(seg)
    const rows = rowCount(seg)
    const edges = Array.from({ length: rows }, (_, r) => {
      const p = sampleSegment(ps[i], seg, r / (rows - 1))
      return [roadPoint(p, half, s), roadPoint(p, -half, s)]
    })
    const out: Pillar[] = []
    for (let r = 0; r < rows - 1; r++) {
      if (plan.kinds[r] !== 'fill' || plan.kinds[r + 1] !== 'fill') continue
      const [al, ar] = edges[r]
      const [bl, br] = edges[r + 1]
      const top = Math.min(al[1], ar[1], bl[1], br[1])
      if (top <= RAISED_MIN) continue
      const ax = (al[0] + ar[0]) / 2
      const az = (al[2] + ar[2]) / 2
      const bx = (bl[0] + br[0]) / 2
      const bz = (bl[2] + br[2]) / 2
      const length = Math.max(Math.hypot(bl[0] - al[0], bl[2] - al[2]), Math.hypot(br[0] - ar[0], br[2] - ar[2]))
      out.push({ x: (ax + bx) / 2, y: 0, z: (az + bz) / 2, heading: Math.atan2(bx - ax, bz - az), halfWidth: half, halfDepth: length / 2, height: top })
    }
    return out
  })
}
