// Shared track format: the types and the constants that define them. Consumed by render
// (src/render/), physics (src/physics/) and the lap loop (src/race/). Pure TypeScript: no three,
// no browser APIs, so physics may import it. The centreline (pose.ts), the shapes built on it
// (shapes.ts), validation (validate.ts) and the layout id (layout-id.ts) live in their own modules
// and are re-exported here, so every importer of the format keeps one entry point.
import type { EnvironmentDefault } from './environment'
import type { Theme } from './theme'

export { constantWidth, exitPose, MAX_ROAD_WIDTH, maxWidth, MIN_ROAD_WIDTH, partialPose, poses, ROAD_WIDTH, sampleSegment, segmentLength, turnCentre, turnSign, widthAt, type Sample } from './pose'
export { BARRIER, barrierPillars, onPad, padLaneMarks, padWalls, barrierPosts, GATE_LEG_MIN_HEIGHT, GATE_PILLAR, gateLegs, gateLine, gatePillars, gateScale, gateUp, gateWidth, padForward, zoneCorners, type Pillar } from './shapes'
export { layoutId } from './layout-id'
export { validate } from './validate'
export { isColour, SKIES, validateTheme, type Sky, type Theme } from './theme'

/** Kit grid cell size in metres (the 10 m Kenney piece). Every piece's footprint is a multiple of it; road width is per segment (widthAt). */
export const CELL = 10

/**
 * The three standard corner radii (m), one driving style each on the 14 m road: tight needs
 * braking (grip limit ~64 km/h), medium is the 90 km/h drift corner (grip limit ~85 km/h, so a
 * 90 km/h entry needs a short speed drift), wide is flat out near top speed (~146 km/h). Measured
 * in src/race/corner-radii.test.ts. Multiples of CELL, so the 90° kit pieces sit on the grid. The
 * kit's corner-* pieces and a free-form `curve` segment's named `radius` both read this one table.
 */
export const CORNER_RADII = { tight: 20, medium: 40, wide: 150 } as const

export type CornerSize = keyof typeof CORNER_RADII

export const CORNER_SIZES = Object.keys(CORNER_RADII) as CornerSize[]

/** World pose at a piece connection edge: bottom-center, heading in radians (0 = +z, CCW positive). */
export interface Pose {
  x: number
  y: number
  z: number
  heading: number
}

export type Turn = 'left' | 'right'

/**
 * Road width of one segment in metres, shoulder to shoulder: a number holds it, [entry, exit]
 * tapers between the two (widthAt, src/track/pose.ts). Omitted: ROAD_WIDTH.
 */
export type Width = number | [number, number]

export type Segment = (
  | { type: 'straight'; length: number }
  | { type: 'curve'; turn: Turn; radius: number; angle: 90 | 45 }
  | { type: 'hairpin'; turn: Turn; radius: number }
  | { type: 'ramp'; length: number; rise: number }
  | { type: 'drop'; length: number; fall: number }
  | { type: 'banked'; turn: Turn; radius: number; angle: 90 | 180; bank: number }
  /** No road: a jump across `length` metres of air, landing `fall` metres lower (default 0). */
  | { type: 'gap'; length: number; fall?: number }
  /**
   * A full vertical loop of `radius` that starts and ends level with its entry; its exit sits
   * `shift` metres (default LOOP_SHIFT) to the `turn` side so the climb and the exit never share
   * road (src/track/pose.ts). A shift of several road widths is the spiral (corkscrew) loop.
   */
  | { type: 'loop'; turn: Turn; radius: number; shift?: number }
  /**
   * A flat turn like `curve` whose outer edge curves up into a near-vertical quarter-pipe the car
   * rides at speed, velodrome-style (src/track/pose.ts wallPoint): v²/r presses it into the wall.
   */
  | { type: 'wallride'; turn: Turn; radius: number; angle: 90 | 180 }
) & { width?: Width }

export type SegmentType = Segment['type']

export const SEGMENT_TYPES: readonly SegmentType[] = ['straight', 'curve', 'hairpin', 'ramp', 'drop', 'banked', 'gap', 'loop', 'wallride']

export type GateKind = 'start-finish' | 'checkpoint'

/**
 * A gate sits on the entry edge of segment `segment` (index into Track.segments), or `at` (0..1)
 * of the way along it. A checkpoint at the top of a loop (`at` 0.5) hangs upside down from the
 * road there (gateUp), so a loop cannot be skipped by changing lanes at its foot.
 */
export interface Gate {
  kind: GateKind
  segment: number
  at?: number
}

/** Medal target lap times in ms; author is the fastest. */
export interface Medals {
  author: number
  gold: number
  silver: number
  bronze: number
}

/**
 * Trackmania-style effect pads: they change the driver's input, not the handling (src/race/effects.ts).
 * no-steer locks the wheel straight, engine-off cuts the throttle, cruise holds the entry speed,
 * slow-mo halves sim time, fragile breaks the car on a hard landing, reset clears them all.
 */
export type EffectKind = 'no-steer' | 'engine-off' | 'cruise' | 'slow-mo' | 'fragile' | 'reset'

export const EFFECT_KINDS: readonly EffectKind[] = ['no-steer', 'engine-off', 'cruise', 'slow-mo', 'fragile', 'reset']

/** Special patches of road: turbo pads (yellow = short boost, red = strong), low-grip surfaces and effect pads. */
export type ZoneKind = 'turbo' | 'turbo-red' | 'dirt' | 'ice' | 'grass' | EffectKind

export const ZONE_KINDS: readonly ZoneKind[] = ['turbo', 'turbo-red', 'dirt', 'ice', 'grass', ...EFFECT_KINDS]

/** Segment types a pad (turbo, turbo-red, effect pads) may lie on: planar strips, so the pad is a flat quad on the road. */
export const ZONE_SEGMENTS: readonly SegmentType[] = ['straight', 'ramp', 'drop']

/** Low-grip surface kinds: full-width patches drawn along the road, curves and banks included. */
export const SURFACE_KINDS = ['dirt', 'ice', 'grass'] as const satisfies readonly ZoneKind[]

/** A low-grip surface kind. */
export type SurfaceKind = (typeof SURFACE_KINDS)[number]

/** True for the surface kinds (dirt, ice, grass). */
export const isSurface = (kind: ZoneKind): kind is SurfaceKind => (SURFACE_KINDS as readonly ZoneKind[]).includes(kind)

/** Segment types a surface zone may lie on: every road piece (not a gap). The patch follows the arc and bank roll. */
export const SURFACE_SEGMENTS: readonly SegmentType[] = ['straight', 'ramp', 'drop', 'curve', 'hairpin', 'banked']

/** Segment types a zone of `kind` may lie on. */
export const zoneSegments = (kind: ZoneKind): readonly SegmentType[] => (isSurface(kind) ? SURFACE_SEGMENTS : ZONE_SEGMENTS)

/** A full-width patch on segment `segment`, from fraction `from` to `to` (0..1) of its length. */
export interface Zone {
  kind: ZoneKind
  segment: number
  from: number
  to: number
  /** Turbo pads only: the arrow points against the segment's direction (default: along it). */
  reverse?: boolean
}

/** True for the effect pad kinds. */
export const isEffect = (kind: string): kind is EffectKind => (EFFECT_KINDS as readonly string[]).includes(kind)

/** True for the zone kinds that boost: turbo pads. */
export const isPad = (kind: ZoneKind): kind is 'turbo' | 'turbo-red' => kind === 'turbo' || kind === 'turbo-red'

/**
 * A wall on the open ground that blocks a shortcut across the grass. Either it follows a road
 * piece's `side` edge `gap` metres off the curb (default BARRIER.gap) over the fraction `from`..`to`
 * of the piece (default all of it), or it runs straight between two world [x, z] points.
 */
export type Barrier =
  | { from: [number, number]; to: [number, number] }
  | { segment: number; side: Turn; gap?: number; from?: number; to?: number }

/**
 * A free-drive test pad: one flat, open asphalt square of `size` metres centred on `centre` [x, z] at
 * y 0, with painted guides — circles of `circles` radii about `circleCentre` and a straight `lane`
 * from `from` to `to` with a distance mark every `marks` metres. The pad drives as road (no offroad
 * inside it) and a track with one is free drive: no finish, no lap (src/race/lap.ts).
 */
export interface Pad {
  centre: [number, number]
  size: number
  circleCentre: [number, number]
  circles: number[]
  lane: { from: [number, number]; to: [number, number]; marks: number }
}

export interface Track {
  name: string
  start: Pose
  segments: Segment[]
  gates: Gate[]
  /** Optional: not part of layoutId, so retuning medals keeps existing records. */
  medals?: Medals
  zones?: Zone[]
  barriers?: Barrier[]
  /** Optional: a free-drive asphalt pad (Pad). */
  pad?: Pad
  /** Optional per-track look (src/track/theme.ts). Render-only and not part of layoutId. */
  theme?: Theme
  /** Optional default time of day and weather (src/track/environment.ts). Render-only and not part of layoutId. */
  environment?: EnvironmentDefault
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
