// Edge rails: a low white rail along both road edges of every piece, Trackmania-style, with a neon
// line on its top. The single source for the rail colliders (src/physics/surface.ts) and the rail
// and neon meshes (src/render/track/rails.ts). Pure TypeScript: no three, no browser APIs.
import { roadPoint, rowCount, SPAN_HEADROOM, SPAN_PATH_SKIP } from './bodies'
import { poses, sampleSegment, segmentLength, turnSign, widthAt } from './pose'
import type { Pillar, Segment, Track } from './schema'

/**
 * Rail section in metres: `width` thick inward from the road edge, `height` above it. It stands on
 * the road's own outer shoulder (and on an embankment's or a deck's top), never past the edge, so
 * something always carries it; on a bridge it lines the inside of the parapet. `height` clears the
 * car's centre (about 0.8 m over the road, which car.ts collide() tests against a box's top).
 */
export const RAIL = { width: 0.3, height: 1 } as const
/** Neon line along the middle of a rail's top: `width` wide, nearly the whole top, so it reads from the chase cam's grazing angle. */
export const NEON = { width: 0.26 } as const

export type RailPoint = [number, number, number]
/** One rail along one edge of one segment: base points across the rail, [inner, outer], at each row. */
export type RailRun = { segment: number; side: 1 | -1; rows: [RailPoint, RailPoint][] }

/**
 * The edges of a segment that carry a rail: both, except a wallride (its wall is the outer edge, so
 * only the inner one) and the pieces with no road edge to line — a gap (no road) and a loop (its own shell).
 */
export const railSides = (seg: Segment): (1 | -1)[] => {
  if (seg.type === 'gap' || seg.type === 'loop') return []
  if (seg.type === 'wallride') return [turnSign(seg) === 1 ? 1 : -1]
  return [1, -1]
}

const lapGap = (a: number, b: number, lap: number): number => {
  const d = Math.abs(a - b) % lap
  return Math.min(d, lap - d)
}

// Road samples bucketed on a coarse grid, to find another part of the lap beside a rail row quickly.
const GRID = 16
type RoadSample = { x: number; y: number; z: number; s: number; w: number }

const roadIndex = (track: Track): { lap: number; near: (x: number, z: number) => RoadSample[] } => {
  const ps = poses(track)
  const grid = new Map<string, RoadSample[]>()
  let at = 0
  let widest = 0
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    if (seg.type !== 'gap') {
      const n = Math.max(1, Math.ceil(len / 1.5))
      for (let k = 0; k <= n; k++) {
        const p = sampleSegment(ps[i], seg, k / n)
        const q = { x: p.x, y: p.y, z: p.z, s: at + (len * k) / n, w: widthAt(seg, k / n) }
        widest = Math.max(widest, q.w)
        const key = `${Math.floor(q.x / GRID)},${Math.floor(q.z / GRID)}`
        const cell = grid.get(key)
        if (cell) cell.push(q)
        else grid.set(key, [q])
      }
    }
    at += len
  })
  const reach = Math.ceil(widest / 2 / GRID)
  const near = (x: number, z: number): RoadSample[] => {
    const gx = Math.floor(x / GRID)
    const gz = Math.floor(z / GRID)
    const out: RoadSample[] = []
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) out.push(...(grid.get(`${gx + dx},${gz + dz}`) ?? []))
    return out
  }
  return { lap: at, near }
}

const cache = new WeakMap<Track, RailRun[]>()

/**
 * Every rail on the lap, along the rows the road mesh is built on (rowCount). A row whose rail would
 * stand on another part of the lap at grade (a loop's run-in beside its run-out) is left out and
 * splits the run there, as an underpass keeps its road open (planDeckPillars).
 */
export const railRuns = (track: Track): RailRun[] => {
  const hit = cache.get(track)
  if (hit) return hit
  const ps = poses(track)
  const { lap, near } = roadIndex(track)
  const runs: RailRun[] = []
  let at = 0
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    const s = turnSign(seg)
    const rows = rowCount(seg)
    for (const side of railSides(seg)) {
      let run: [RailPoint, RailPoint][] = []
      for (let r = 0; r < rows; r++) {
        const t = r / (rows - 1)
        const p = sampleSegment(ps[i], seg, t)
        const half = widthAt(seg, t) / 2
        const inner = roadPoint(p, side * (half - RAIL.width), s)
        const outer = roadPoint(p, side * half, s)
        const mx = (inner[0] + outer[0]) / 2
        const mz = (inner[2] + outer[2]) / 2
        const here = at + len * t
        const onRoad = near(mx, mz).some((q) => Math.abs(q.y - p.y) < SPAN_HEADROOM && lapGap(q.s, here, lap) > SPAN_PATH_SKIP && Math.hypot(q.x - mx, q.z - mz) < q.w / 2)
        if (!onRoad) {
          run.push([inner, outer])
          continue
        }
        if (run.length > 1) runs.push({ segment: i, side, rows: run })
        run = []
      }
      if (run.length > 1) runs.push({ segment: i, side, rows: run })
    }
    at += len
  })
  cache.set(track, runs)
  return runs
}

/**
 * The rails as solid upright boxes, one between each pair of rows: RAIL.width thick, as long as the
 * longer of its two faces (so a curve's outer face has no gap), standing on the lowest base corner up
 * to RAIL.height above the highest — the swept rail the render draws fits inside each box.
 */
export const railBoxes = (track: Track): Pillar[] =>
  railRuns(track).flatMap(({ rows }) =>
    rows.slice(1).map(([bi, bo], k) => {
      const [ai, ao] = rows[k]
      const ax = (ai[0] + ao[0]) / 2
      const az = (ai[2] + ao[2]) / 2
      const bx = (bi[0] + bo[0]) / 2
      const bz = (bi[2] + bo[2]) / 2
      const foot = Math.min(ai[1], ao[1], bi[1], bo[1])
      const top = Math.max(ai[1], ao[1], bi[1], bo[1]) + RAIL.height
      const length = Math.max(Math.hypot(bi[0] - ai[0], bi[2] - ai[2]), Math.hypot(bo[0] - ao[0], bo[2] - ao[2]))
      return { x: (ax + bx) / 2, y: foot, z: (az + bz) / 2, heading: Math.atan2(bx - ax, bz - az), halfWidth: RAIL.width / 2, halfDepth: length / 2, height: top - foot }
    }),
  )
