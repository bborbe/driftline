// Where the trackside dressing stands: brake boards (100 / 50) on each numbered corner's approach,
// a corner-number board at its entry, banners and catch fences on its outside, a marshal post at its
// exit, and grass/terrain colour patches along the verge. Pure and deterministic (no three, seeded
// PRNG), unit-tested in trackside-plan.test.ts; trackside.ts builds the meshes.
import { centreline } from '../../track/centreline'
import { onPad, segmentLength, turnSign, type Segment, type Track } from '../../track/schema'
import { planDressing, type DressingKind } from './dressing'
import { gateLegs, gatePillars } from '../../track/shapes'
import { BOARD as CHEVRON, planSigns } from './signs'
import { planStadium } from './stadium'

/** A printed board standing at (x, y, z), its face looking toward `heading` (0 = +z). */
export type Board = { kind: 'brake-100' | 'brake-50' | 'corner'; label: number; x: number; y: number; z: number; heading: number }
/** A banner hoarding centred on (x, y, z), `length` metres long, face toward `heading`. */
export type Banner = { variant: 0 | 1; x: number; y: number; z: number; heading: number; length: number }
/** A marshal post: a small booth with a flag pole, front toward `heading`. */
export type MarshalPost = { x: number; y: number; z: number; heading: number }
/** A catch fence along `points` (x, z), standing on height `y`. */
export type Fence = { y: number; points: [number, number][] }
/** A ground colour patch: an irregular blob of radius ~`radius`, `shade` of the ground colour. */
export type Patch = { x: number; z: number; radius: number; heading: number; shade: 'dark' | 'light' | 'dirt' }

export type TracksidePlan = { boards: Board[]; banners: Banner[]; marshals: MarshalPost[]; fences: Fence[]; patches: Patch[] }

/** A numbered corner: a turning segment of at least MIN_CORNER_ANGLE, 1.. in lap order. */
export type Corner = { label: number; segment: number; entry: number; exit: number; side: number }

/** Turns sharper than this (degrees) get a number and brake boards. */
export const MIN_CORNER_ANGLE = 60
/** Brake boards: their distance before the corner entry, which is also what they print (within BOARD_SLIDE). */
export const BRAKE_DISTANCES = [100, 50] as const
/** How far a brake board may stand from its printed distance, to fall between flag poles. */
export const BOARD_SLIDE = 3
/** Nothing stands within this of any road at its level, past that road's own edge: the curb and a margin. */
export const EDGE_CLEAR = 1.5
/** Lateral distances past the road edge, metres. Patches start past the flag rows (dressing.ts FLAG_EDGE 4). */
export const OFFSET = { board: 2.8, banner: 6, marshal: 9, fence: 11, patchMin: 5.5, patchMax: 12 } as const
/** How far each item reaches from its centre, metres: what placement keeps clear and footprints() reports. */
export const REACH = { board: 1.2, bannerEnd: 0.5, marshal: 2.5, fence: 0.6 } as const
/** Roads more than this far above or below an item do not block it. */
const LEVEL = 4
/** Nothing stands beside road higher than this (decks, ramp tops): it would hang over the void. */
const GROUND = 1

/** How far each stadium-dressing prop reaches from its foot (dressing.ts): a pole and its cloth, a totem, the start screen. */
export const DRESSING_REACH: Record<DressingKind, number> = { flag: 1.2, totem: 1.8, startScreen: 7.5 }

const TURNING = new Set<Segment['type']>(['curve', 'hairpin', 'banked'])
export const turnAngle = (seg: Segment): number => (seg.type === 'hairpin' ? 180 : TURNING.has(seg.type) && 'angle' in seg ? (seg.angle as number) : 0)

// mulberry32, as scenery.ts: every load places the same dressing.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Every turning segment of at least MIN_CORNER_ANGLE, numbered in lap order, with its lap distances. */
export const corners = (track: Track): Corner[] => {
  const out: Corner[] = []
  let d = 0
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    if (TURNING.has(seg.type) && turnAngle(seg) >= MIN_CORNER_ANGLE) out.push({ label: out.length + 1, segment: i, entry: d, exit: d + len, side: turnSign(seg) })
    d += len
  })
  return out
}

/** Straight road before `c`: lap distance back to the previous turning segment's exit (wrapping). */
export const approachLength = (track: Track, c: Corner): number => {
  const lens = track.segments.map(segmentLength)
  const total = lens.reduce((a, b) => a + b, 0)
  let back = 0
  for (let k = 1; k < track.segments.length; k++) {
    const i = (c.segment - k + track.segments.length) % track.segments.length
    if (TURNING.has(track.segments[i].type)) return back
    back += lens[i]
  }
  return Math.min(back, total)
}

export const planTrackside = (track: Track, seed = 11): TracksidePlan => {
  const line = centreline(track, 1)
  const total = line.length
  const at = (d: number) => line[((Math.round(d) % total) + total) % total]
  /** A point `u` metres left of the centreline at lap distance d (lateral is (cos h, -sin h)). */
  const beside = (d: number, u: number) => {
    const p = at(d)
    return { x: p.x + Math.cos(p.heading) * u, y: p.y, z: p.z - Math.sin(p.heading) * u, p }
  }
  /** Facing the road from a point placed `u` metres to the side. */
  const facingRoad = (heading: number, u: number) => Math.atan2(-Math.sign(u) * Math.cos(heading), Math.sign(u) * Math.sin(heading))
  /** The stadium dressing's props (flag rows, totems, start screen) as footprints: nothing lands on them. */
  const dressing: (readonly [number, number, number])[] = [
    ...planDressing(track).map((d) => [d.x, d.z, DRESSING_REACH[d.kind]] as const),
    // Start and checkpoint arch pillars (and the legs under an elevated arch), and the turn / turbo boards (signs.ts).
    ...track.gates.flatMap((g) => [...gatePillars(track, g), ...gateLegs(track, g)].map((q) => [q.x, q.z, Math.hypot(q.halfWidth, q.halfDepth)] as const)),
    ...planSigns(track).map((q) => [q.x, q.z, CHEVRON.width / 2 + 0.3] as const),
  ]
  const plan: TracksidePlan = { boards: [], banners: [], marshals: [], fences: [], patches: [] }
  /** Footprints of what is already planned, kept up to date by mark() (footprints() of one item at a time). */
  const placed: [number, number, number][] = []
  const mark = (part: Partial<TracksidePlan>) => placed.push(...footprints({ boards: [], banners: [], marshals: [], fences: [], patches: [], ...part }))
  /** Clear of every road at its level by EDGE_CLEAR + r, on the ground, off any free-drive pad and dressing prop. */
  const clear = (x: number, y: number, z: number, r: number) =>
    y < GROUND &&
    !(track.pad && onPad(track.pad, x, z, -(r + 2))) &&
    dressing.every(([dx, dz, dr]) => Math.hypot(dx - x, dz - z) >= dr + r) &&
    // Nor on what this plan has already placed (a neighbouring corner's banner, fence or marshal post).
    placed.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) >= pr + r) &&
    line.every((c) => Math.abs(c.y - y) > LEVEL || Math.hypot(c.x - x, c.z - z) - c.width / 2 >= EDGE_CLEAR + r)

  const cs = corners(track)
  for (const c of cs) {
    const out = -c.side // the outside of the turn is away from its centre
    const approach = approachLength(track, c)
    // Brake boards and the corner number on the approach, on the outside, facing the oncoming car.
    const boards: [Board['kind'], number, number][] = BRAKE_DISTANCES.filter((dist) => dist <= approach - 5).map((dist) => [dist === 100 ? 'brake-100' : 'brake-50', dist, c.entry - dist])
    for (const [kind, label, d0] of boards) {
      // A flag row (dressing.ts) lines most straights every 8 m: slide up to BOARD_SLIDE metres along the lap into a gap.
      for (const nudge of [0, 1, -1, 2, -2, 3, -3]) {
        const d = d0 + nudge
        const p = at(d)
        const s = beside(d, out * (p.width / 2 + OFFSET.board))
        if (!clear(s.x, s.y, s.z, REACH.board)) continue
        const board: Board = { kind, label, x: s.x, y: s.y, z: s.z, heading: p.heading + Math.PI }
        plan.boards.push(board)
        mark({ boards: [board] })
        break
      }
    }
    // The number stands ~12 m before the entry, or as close after that as the ground allows (past a ramp's drop).
    for (let d = c.entry - Math.min(12, Math.max(0, approach - 2)); d <= c.entry + 4; d += 2) {
      const p = at(d)
      const s = beside(d, out * (p.width / 2 + OFFSET.board))
      if (!clear(s.x, s.y, s.z, REACH.board)) continue
      const board: Board = { kind: 'corner', label: c.label, x: s.x, y: s.y, z: s.z, heading: p.heading + Math.PI }
      plan.boards.push(board)
      mark({ boards: [board] })
      break
    }
    // A banner at the apex and a fence along the outside of the arc.
    // The apex first, else the first clear spot either side of it along the arc.
    let mid = (c.entry + c.exit) / 2
    for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const d = c.entry + (c.exit - c.entry) * f
      const bp = at(d)
      const bu = out * (bp.width / 2 + OFFSET.banner)
      const b = beside(d, bu)
      if (!clear(b.x, b.y, b.z, 8 / 2 + REACH.bannerEnd)) continue
      const banner: Banner = { variant: (c.label % 2) as 0 | 1, x: b.x, y: b.y, z: b.z, heading: facingRoad(bp.heading, bu), length: 8 }
      plan.banners.push(banner)
      mark({ banners: [banner] })
      mid = d
      break
    }
    let run: [number, number][] = []
    let runY = 0
    const flush = () => {
      if (run.length >= 2) {
        plan.fences.push({ y: runY, points: run })
        mark({ fences: [{ y: runY, points: run }] })
      }
      run = []
    }
    for (let d = c.entry; d <= c.exit; d += 4) {
      const p = at(d)
      const f = beside(d, out * (p.width / 2 + OFFSET.fence))
      // Keep the banner's span open: the fence runs behind it, not through it.
      const nearBanner = Math.abs(d - mid) < 6 || plan.banners.some((bn) => Math.hypot(bn.x - f.x, bn.z - f.z) < bn.length / 2 + 1)
      if (!nearBanner && clear(f.x, f.y, f.z, REACH.fence)) {
        if (run.length === 0) runY = 0 // fences stand on the ground
        run.push([f.x, f.z])
      } else flush()
    }
    flush()
    // A marshal post just past the exit, on the outside.
    const mp = at(c.exit + 6)
    const mu = out * (mp.width / 2 + OFFSET.marshal)
    const m = beside(c.exit + 6, mu)
    if (clear(m.x, m.y, m.z, REACH.marshal)) {
      const marshal: MarshalPost = { x: m.x, y: 0, z: m.z, heading: facingRoad(mp.heading, mu) }
      plan.marshals.push(marshal)
      mark({ marshals: [marshal] })
    }
  }
  // Colour patches along the verge, at irregular intervals, either side.
  const rand = rng(seed)
  const shades: Patch['shade'][] = ['dark', 'light', 'dirt']
  for (let d = rand() * 20; d < total; d += 12 + rand() * 38) {
    const p = at(d)
    const radius = 2.5 + rand() * 3.5
    const side = rand() < 0.5 ? 1 : -1
    const off = p.width / 2 + OFFSET.patchMin + radius + rand() * (OFFSET.patchMax - OFFSET.patchMin)
    const heading = rand() * Math.PI * 2
    const shade = shades[Math.floor(rand() * shades.length)]
    // Compact laps fold back on themselves: a blocked side tries the other.
    const q = [side, -side].map((sd) => beside(d, sd * off)).find((q) => clear(q.x, q.y, q.z, radius))
    if (q) plan.patches.push({ x: q.x, z: q.z, radius, heading, shade })
  }
  return plan
}

/** Every planned item as footprint circles (x, z, r), fence spans sampled every metre. */
export const footprints = (plan: TracksidePlan): [number, number, number][] => [
  ...plan.boards.map((b): [number, number, number] => [b.x, b.z, REACH.board]),
  ...plan.banners.map((b): [number, number, number] => [b.x, b.z, b.length / 2 + REACH.bannerEnd]),
  ...plan.marshals.map((m): [number, number, number] => [m.x, m.z, REACH.marshal]),
  ...plan.fences.flatMap((f) =>
    f.points.slice(1).flatMap(([x1, z1], i) => {
      const [x0, z0] = f.points[i]
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)))
      return Array.from({ length: n + 1 }, (_, k): [number, number, number] => [x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n, REACH.fence])
    }),
  ),
]

/** What scenery (scenery.ts) keeps clear of: the trackside dressing and the stadium ring (stadium.ts), as circles. */
export const sceneryKeepClear = (track: Track, plan: TracksidePlan): [number, number, number][] => [
  ...footprints(plan),
  ...planStadium(track).map((p): [number, number, number] => [p.x, p.z, p.model === 'screen' ? 14 : p.scale * 0.75]),
]
