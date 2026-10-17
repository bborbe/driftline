// Track piece kit: Trackmania-style drivable pieces that snap on a grid. Each piece is ONE
// definition that expands to schema Segments, zones, gates and barriers, so the render mesh
// (src/render/track) and the physics collider (src/physics/surface.ts) both derive from it and
// can never disagree. A kit track is a list of placed pieces; compileKit() turns it into a
// plain Track, so everything downstream (lap loop, ghost, render) is unchanged.
// Pure TypeScript: no three, no browser APIs, so physics may import it.
import { CELL, CORNER_RADII, exitPose, segmentLength, widthAt, type Barrier, type Gate, type GateKind, type Pose, type Segment, type Track, type Turn, type Width, type Zone, type ZoneKind } from './schema'

/** Height of one kit level in metres. Every connector sits on a multiple of it. */
export const LEVEL = 4

/** Road surface a piece is built in. Non-road surfaces are full-length zones on every segment of the piece. */
export type KitSurface = 'road' | 'dirt' | 'ice' | 'grass'

export const KIT_SURFACES: readonly KitSurface[] = ['road', 'dirt', 'ice', 'grass']

/** What leaves a connector: road the car drives on. A jump keeps its air inside the piece (gap-jump). */
export type ConnectorKind = 'road'

/**
 * A piece's exit connector, relative to its entry connector, in grid units: `forward` cells
 * along the entry heading, `left` cells to its left, `up` levels, `turn` quarter turns CCW.
 * Every kit connector is flat across (bank 0) — banked pieces ease in and out inside the piece.
 */
export interface Connector {
  forward: number
  left: number
  up: number
  turn: number
  bank: 0
  kind: ConnectorKind
}

/** Families follow the Trackmania Stadium block families (see docs/track-kit.md). */
export type PieceFamily = 'road' | 'curve' | 'slope' | 'bank' | 'effect' | 'gate' | 'wall' | 'loop' | 'wallride'

/** A piece's contents, relative to its first segment. */
export interface Expansion {
  segments: Segment[]
  zones: { kind: ZoneKind; segment: number; from: number; to: number }[]
  gates: { kind: GateKind; segment: number; at?: number }[]
  /** Barriers along both sides (ground level only: schema barriers stand on y = 0). */
  walls: boolean
}

export interface PieceDef {
  id: string
  family: PieceFamily
  /** Surfaces the piece can be built in; the first is the default. */
  surfaces: readonly KitSurface[]
  /** True when the piece turns, so a placement may pick left or right. */
  turns: boolean
  /** Exit connector for a LEFT turn (a right turn mirrors `left` and `turn`). */
  out: Connector
  expand(turn: Turn): Expansion
}

const road = (forward: number, left: number, up: number, turn: number): Connector => ({ forward, left, up, turn, bank: 0, kind: 'road' })
const plain = (segments: Segment[], extra: Partial<Expansion> = {}): Expansion => ({ segments, zones: [], gates: [], walls: false, ...extra })
// Every road piece comes in every surface; only pieces with a gap (air) or a pad/gate stay road.
const ANY: readonly KitSurface[] = KIT_SURFACES
const ROAD_ONLY: readonly KitSurface[] = ['road']

/** Kit bank angle (radians): the proven 0.26 of lap1/lap2, well inside the 0.6 rad limit. */
export const KIT_BANK = 0.26

/** Wide-bank angle (radians): steeper than KIT_BANK, inside the 0.6 rad limit. */
export const KIT_BANK_WIDE = 0.45

/**
 * Loop radius (m): 30 m tall. Measured on a full-throttle car (docs/track-kit.md § loop): it stays
 * on through the top from 12.1 m/s at the entry (≈ √(g·r), the apex's own need) up to 40 m/s.
 */
export const KIT_LOOP_RADIUS = 15

/** Spiral loop exit offset (cells): the car comes out of the loop on a parallel line this far to the turn side. */
export const KIT_SPIRAL_SHIFT = 2

/** Wallride turn radius (m): a 180° velodrome turn whose outer edge rises into the wall. */
export const KIT_WALLRIDE_RADIUS = 3 * CELL

const curve = (id: string, cells: number): PieceDef => ({
  id,
  family: 'curve',
  surfaces: ANY,
  turns: true,
  out: road(cells, cells, 0, 1),
  expand: (turn) => plain([{ type: 'curve', turn, radius: cells * CELL, angle: 90 }]),
})

const flat = (id: string, family: PieceFamily, extra: Partial<Expansion>, cells = 1): PieceDef => ({
  id,
  family,
  surfaces: ROAD_ONLY,
  turns: false,
  out: road(cells, 0, 0, 0),
  expand: () => plain([{ type: 'straight', length: cells * CELL }], extra),
})

/** Every piece type of the kit, in catalogue order. */
export const KIT_PIECES: readonly PieceDef[] = [
  { ...flat('straight-1', 'road', {}), surfaces: ANY },
  { ...flat('straight-2', 'road', {}, 2), surfaces: ANY },
  curve('curve-r1', 1),
  curve('curve-r2', 2),
  curve('curve-r3', 3),
  // The three standard corner radii (CORNER_RADII): tight brakes, medium is the 90 km/h drift
  // corner, wide is flat out. corner-tight shares curve-r2's geometry under its style name. The wide
  // 90° is two 45° halves (one arc, the same geometry): a 235 m arc in one segment is too coarse for
  // the test autopilot's 20 samples per segment, whose line then cuts into the inner edge rail.
  curve('corner-tight', CORNER_RADII.tight / CELL),
  curve('corner-medium', CORNER_RADII.medium / CELL),
  {
    ...curve('corner-wide', CORNER_RADII.wide / CELL),
    expand: (turn) =>
      plain([
        { type: 'curve', turn, radius: CORNER_RADII.wide, angle: 45 },
        { type: 'curve', turn, radius: CORNER_RADII.wide, angle: 45 },
      ]),
  },
  { id: 'hairpin', family: 'curve', surfaces: ANY, turns: true, out: road(0, 2, 0, 2), expand: (turn) => plain([{ type: 'hairpin', turn, radius: CELL }]) },
  { id: 'slope-up', family: 'slope', surfaces: ANY, turns: false, out: road(2, 0, 1, 0), expand: () => plain([{ type: 'ramp', length: 2 * CELL, rise: LEVEL }]) },
  { id: 'slope-down', family: 'slope', surfaces: ANY, turns: false, out: road(2, 0, -1, 0), expand: () => plain([{ type: 'drop', length: 2 * CELL, fall: LEVEL }]) },
  {
    id: 'bump',
    family: 'slope',
    surfaces: ANY,
    turns: false,
    out: road(2, 0, 0, 0),
    expand: () =>
      plain([
        { type: 'ramp', length: CELL, rise: 1 },
        { type: 'drop', length: CELL, fall: 1 },
      ]),
  },
  {
    id: 'bank-90',
    family: 'bank',
    surfaces: ANY,
    turns: true,
    out: road(2, 2, 0, 1),
    expand: (turn) => plain([{ type: 'banked', turn, radius: 2 * CELL, angle: 90, bank: KIT_BANK }]),
  },
  {
    id: 'bank-180',
    family: 'bank',
    surfaces: ANY,
    turns: true,
    out: road(0, 4, 0, 2),
    expand: (turn) => plain([{ type: 'banked', turn, radius: 2 * CELL, angle: 180, bank: KIT_BANK }]),
  },
  {
    // Flat-out 180 (Fullspeed): r 80 m holds a full-throttle, no-brake car near its 40 m/s top
    // speed; tighter banks need braking whatever their angle (measured r 30–80 m × 0.26–0.6 rad).
    id: 'bank-180-wide',
    family: 'bank',
    surfaces: ANY,
    turns: true,
    out: road(0, 16, 0, 2),
    expand: (turn) => plain([{ type: 'banked', turn, radius: 8 * CELL, angle: 180, bank: KIT_BANK_WIDE }]),
  },
  {
    // Kicker, gap, landing: crossover's jump on the grid. Both connectors are road; the air is
    // inside the piece. A 5.7° lip, then a landing slope that continues the line from the lip and
    // runs long enough for a flat-out car, so it lands tangent to the arc at any speed (AGENTS.md).
    id: 'gap-jump',
    family: 'slope',
    surfaces: ROAD_ONLY,
    turns: false,
    out: road(10, 0, -2, 0),
    expand: () =>
      plain([
        { type: 'ramp', length: CELL, rise: 1 },
        { type: 'gap', length: CELL, fall: 1.8 },
        // Net two levels down: +1 lip, −1.8 gap, −7.2 landing.
        { type: 'drop', length: 8 * CELL, fall: 7.2 },
      ]),
  },
  {
    // Full vertical loop: a run-in, the loop, a run-out, one cell to the turn side (the climb and
    // the exit never share road). Road only, so its grip and the measured entry speed hold. A
    // checkpoint hangs at the top: the exit lane starts beside the foot, so without it a lane
    // change there would skip the loop.
    id: 'loop',
    family: 'loop',
    surfaces: ROAD_ONLY,
    turns: true,
    out: road(3, 1, 0, 0),
    expand: (turn) =>
      plain(
        [
          { type: 'straight', length: KIT_LOOP_RADIUS },
          { type: 'loop', turn, radius: KIT_LOOP_RADIUS },
          { type: 'straight', length: KIT_LOOP_RADIUS },
        ],
        { gates: [{ kind: 'checkpoint', segment: 1, at: 0.5 }] },
      ),
  },
  {
    // Spiral (corkscrew) loop: the kit loop with its road drifting KIT_SPIRAL_SHIFT cells to the turn
    // side on the way round, so the car comes out on a parallel line beside the one it came in on.
    // The same checkpoint at the top as the loop: a straight cut across the grass to the exit line
    // otherwise beats driving it (cuts.test.ts, velodrome).
    id: 'spiral',
    family: 'loop',
    surfaces: ROAD_ONLY,
    turns: true,
    out: road(3, KIT_SPIRAL_SHIFT, 0, 0),
    expand: (turn) =>
      plain(
        [
          { type: 'straight', length: KIT_LOOP_RADIUS },
          { type: 'loop', turn, radius: KIT_LOOP_RADIUS, shift: KIT_SPIRAL_SHIFT * CELL },
          { type: 'straight', length: KIT_LOOP_RADIUS },
        ],
        { gates: [{ kind: 'checkpoint', segment: 1, at: 0.5 }] },
      ),
  },
  {
    // Velodrome 180: a flat turn whose outer edge curves up into a near-vertical wall the car rides
    // at speed (src/track/pose.ts wallPoint). Road only, ground level only (the wall stands on y = 0).
    id: 'wallride',
    family: 'wallride',
    surfaces: ROAD_ONLY,
    turns: true,
    out: road(0, 6, 0, 2),
    expand: (turn) => plain([{ type: 'wallride', turn, radius: KIT_WALLRIDE_RADIUS, angle: 180 }]),
  },
  flat('turbo', 'effect', { zones: [{ kind: 'turbo', segment: 0, from: 0.25, to: 0.75 }] }),
  flat('turbo-red', 'effect', { zones: [{ kind: 'turbo-red', segment: 0, from: 0.25, to: 0.75 }] }),
  flat('checkpoint', 'gate', { gates: [{ kind: 'checkpoint', segment: 0 }] }),
  // Two cells: the start/finish arch stands mid-tile (schema START_ARCH_FRACTION).
  flat('start', 'gate', { gates: [{ kind: 'start-finish', segment: 0 }] }, 2),
  { ...flat('walled', 'wall', { walls: true }, 2), surfaces: ANY },
]

const BY_ID = new Map(KIT_PIECES.map((p) => [p.id, p]))

export const pieceDef = (id: string): PieceDef | undefined => BY_ID.get(id)

/** Exit connector for a placement: a right turn mirrors the left-turn connector. */
export const outConnector = (def: PieceDef, turn: Turn = 'left'): Connector =>
  turn === 'left' || !def.turns ? def.out : { ...def.out, left: -def.out.left, turn: -def.out.turn }

/** World pose of a connector placed at `entry`. */
export const connectorPose = (entry: Pose, c: Connector): Pose => {
  const fx = Math.sin(entry.heading)
  const fz = Math.cos(entry.heading)
  // Left of travel is (+cos h, -sin h): the side schema.ts arcs turn towards for 'left'.
  return {
    x: entry.x + (fx * c.forward + fz * c.left) * CELL,
    y: entry.y + c.up * LEVEL,
    z: entry.z + (fz * c.forward - fx * c.left) * CELL,
    heading: entry.heading + (c.turn * Math.PI) / 2,
  }
}

/** True when a pose sits on the kit grid: x, z on CELL lines, y on a LEVEL, heading a quarter turn. */
export const onGrid = (p: Pose, eps = 1e-6): boolean => {
  const near = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) * step < eps
  return near(p.x, CELL) && near(p.z, CELL) && near(p.y, LEVEL) && near(p.heading, Math.PI / 2)
}

/** One placed piece in a kit track. */
export interface Placement {
  piece: string
  turn?: Turn
  surface?: KitSurface
  /**
   * Walls along the piece, following the road (curves and banks too): 'both' sides, or only the
   * 'left' / 'right' one, flush with the road edge. Ground level only, like `walled` (barriers
   * stand on y = 0). Closes a cut that pays, e.g. across the grass beside a dirt or ice corner.
   */
  walls?: 'both' | Turn
  /**
   * Road width of the piece (see Segment `width`): a number for every segment it expands to, or
   * [entry, exit] to taper across the whole piece, split over its segments by length. Omitted:
   * ROAD_WIDTH, or one LOOP_SHIFT lane on a loop. The grid stays CELL.
   */
  width?: Width
}

/** Kit track start: grid cell [x, z], level, and direction in quarter turns (0 = +z, CCW). */
export interface KitStart {
  cell: [number, number]
  level: number
  dir: number
}

/** A kit track file: assets/track/<name>.json with a `kit` block instead of `segments`. */
export interface KitTrack {
  name: string
  kit: { start: KitStart; pieces: Placement[] }
  medals?: Track['medals']
  theme?: Track['theme']
  environment?: Track['environment']
}

export const isKitTrack = (data: unknown): data is KitTrack => {
  const kit = (data as { kit?: unknown } | null)?.kit
  return typeof kit === 'object' && kit !== null
}

/** Barrier offset past the road edge for the `walled` piece's own walls (road half width + this). */
const WALL_OFFSET = 0.6

// A placement's width on each of its segments: a number on every one, a taper split by length.
function pieceWidths(segments: Segment[], width: Width): Segment[] {
  if (typeof width === 'number') return segments.map((seg) => ({ ...seg, width }))
  const total = segments.reduce((d, seg) => d + segmentLength(seg), 0)
  const at = (d: number) => width[0] + ((width[1] - width[0]) * d) / total
  let d = 0
  return segments.map((seg) => {
    const from = at(d)
    d += segmentLength(seg)
    return { ...seg, width: [from, at(d)] }
  })
}

export interface CompiledKit {
  track: Track
  /** Entry pose of every placed piece followed by the final exit pose. */
  poses: Pose[]
  /** Index of each placed piece's first segment in track.segments. */
  firstSegment: number[]
}

/**
 * Compile a kit track to a plain Track. Throws with the offending piece index when a piece is
 * unknown, built in a surface it does not support, walled above ground, off the grid, or when
 * the lap does not close back onto its start connector.
 */
export function compileKit(kt: KitTrack): CompiledKit {
  const { start, pieces } = kt.kit
  const startPose: Pose = { x: start.cell[0] * CELL, y: start.level * LEVEL, z: start.cell[1] * CELL, heading: (start.dir * Math.PI) / 2 }
  const segments: Segment[] = []
  const zones: Zone[] = []
  const gates: Gate[] = []
  const barriers: Barrier[] = []
  const ps: Pose[] = [startPose]
  const firstSegment: number[] = []
  pieces.forEach((pl, i) => {
    const def = pieceDef(pl.piece)
    if (!def) throw new Error(`kit piece ${i}: unknown piece ${pl.piece}`)
    const surface = pl.surface ?? def.surfaces[0]
    if (!def.surfaces.includes(surface)) throw new Error(`kit piece ${i}: ${def.id} has no ${surface} variant`)
    if (pl.turn && !def.turns) throw new Error(`kit piece ${i}: ${def.id} does not turn`)
    const entry = ps[ps.length - 1]
    if (!onGrid(entry)) throw new Error(`kit piece ${i}: entry is off the grid`)
    const turn = pl.turn ?? 'left'
    const expanded = def.expand(turn)
    const ex = pl.width === undefined ? expanded : { ...expanded, segments: pieceWidths(expanded.segments, pl.width) }
    const base = segments.length
    firstSegment.push(base)
    let pose = entry
    for (const seg of ex.segments) {
      segments.push(seg)
      pose = exitPose(pose, seg)
    }
    for (const z of ex.zones) zones.push({ ...z, segment: base + z.segment })
    if (surface !== 'road') ex.segments.forEach((_, k) => zones.push({ kind: surface, segment: base + k, from: 0, to: 1 }))
    for (const g of ex.gates) gates.push({ ...g, segment: base + g.segment })
    if (pl.walls) {
      if (!['both', 'left', 'right'].includes(pl.walls)) throw new Error(`kit piece ${i}: walls must be both, left or right`)
      // A gate's pillars stand where the wall would, and `walled` already carries its own barriers.
      if (def.family === 'gate' || def.family === 'wall') throw new Error(`kit piece ${i}: ${def.id} takes no walls`)
      let p = entry
      const onGround = ex.segments.every((seg) => {
        p = exitPose(p, seg)
        return seg.type !== 'gap' && Math.abs(p.y) < 1e-9
      })
      if (Math.abs(entry.y) > 1e-9 || !onGround) throw new Error(`kit piece ${i}: ${def.id} walls stand on the ground only`)
      const sides: Turn[] = pl.walls === 'both' ? ['left', 'right'] : [pl.walls]
      // Flush with the road edge (gap 0): a grass verge inside the wall would still pay on dirt or ice.
      // A banked segment gets its inner wall only: its outer edge rises above a ground-standing wall
      // (bank 0.26 lifts it 1.3 m, the wall is 1.2 m), and running wide off a bank is never a shortcut.
      ex.segments.forEach((seg, k) =>
        sides.forEach((side) => {
          // A wallride's outer side is its wall: only the inner side takes a barrier.
          if ((seg.type === 'banked' || seg.type === 'wallride') && side !== seg.turn) return
          barriers.push({ segment: base + k, side, gap: 0 })
        }),
      )
    }
    if (ex.walls) {
      if (Math.abs(entry.y) > 1e-9 || Math.abs(pose.y) > 1e-9) throw new Error(`kit piece ${i}: ${def.id} walls stand on the ground only`)
      const fx = Math.sin(entry.heading)
      const fz = Math.cos(entry.heading)
      const offset = widthAt(ex.segments[0], 0) / 2 + WALL_OFFSET
      for (const side of [1, -1]) {
        const ox = fz * side * offset
        const oz = -fx * side * offset
        barriers.push({ from: [entry.x + ox, entry.z + oz], to: [pose.x + ox, pose.z + oz] })
      }
    }
    ps.push(connectorPose(entry, outConnector(def, turn)))
  })
  const end = ps[ps.length - 1]
  const turns = (end.heading - startPose.heading) / (2 * Math.PI)
  const closed = Math.hypot(end.x - startPose.x, end.y - startPose.y, end.z - startPose.z) < 1e-6 && Math.abs(turns - Math.round(turns)) < 1e-9
  if (!closed) throw new Error(`kit track ${kt.name}: lap does not close (ends at ${fmt(end)}, starts at ${fmt(startPose)})`)
  const track: Track = { name: kt.name, start: startPose, segments, gates }
  if (kt.medals) track.medals = kt.medals
  if (kt.theme) track.theme = kt.theme
  if (kt.environment) track.environment = kt.environment
  if (zones.length) track.zones = zones
  if (barriers.length) track.barriers = barriers
  return { track, poses: ps, firstSegment }
}

const fmt = (p: Pose) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`

const isCornerSize = (r: unknown): r is keyof typeof CORNER_RADII => typeof r === 'string' && Object.hasOwn(CORNER_RADII, r)

/**
 * A spline track's named corner radii resolved to metres: a `curve` segment may give its radius
 * as "tight" | "medium" | "wide" (CORNER_RADII), at 45° or 90°. A track that names none, or that
 * is not a track object, is returned as is; an unknown name stays a string and fails validation.
 */
export const resolveCornerRadii = (data: unknown): unknown => {
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { segments?: unknown }).segments)) return data
  const segments = (data as { segments: unknown[] }).segments
  const named = (seg: unknown) => typeof seg === 'object' && seg !== null && (seg as { type?: unknown }).type === 'curve' && isCornerSize((seg as { radius?: unknown }).radius)
  if (!segments.some(named)) return data
  return { ...data, segments: segments.map((seg) => (named(seg) ? { ...(seg as object), radius: CORNER_RADII[(seg as { radius: keyof typeof CORNER_RADII }).radius] } : seg)) }
}

/** A track file as loaded: kit tracks are compiled, spline tracks pass through with named corner radii resolved. */
export const resolveTrack = (data: unknown): unknown => (isKitTrack(data) ? compileKit(data).track : resolveCornerRadii(data))
