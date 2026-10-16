// Shared track format: the types and the constants that define them. Consumed by render
// (src/render/), physics (src/physics/) and the lap loop (src/race/). Pure TypeScript: no three,
// no browser APIs, so physics may import it. The centreline (pose.ts), the shapes built on it
// (shapes.ts), validation (validate.ts) and the layout id (layout-id.ts) live in their own modules
// and are re-exported here, so every importer of the format keeps one entry point.
import { ROAD_WIDTH } from './pose'

export { exitPose, partialPose, poses, ROAD_WIDTH, sampleSegment, segmentLength, turnCentre, turnSign, type Sample } from './pose'
export { BARRIER, barrierPillars, barrierPosts, GATE_PILLAR, gateLine, gatePillars, padForward, zoneCorners, type Pillar } from './shapes'
export { layoutId } from './layout-id'
export { validate } from './validate'

/** Grid cell size in metres: one road width. Every piece's footprint is a multiple of it. */
export const CELL = ROAD_WIDTH

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
  /** No road: a jump across `length` metres of air, landing `fall` metres lower (default 0). */
  | { type: 'gap'; length: number; fall?: number }

export type SegmentType = Segment['type']

export const SEGMENT_TYPES: readonly SegmentType[] = ['straight', 'curve', 'hairpin', 'ramp', 'drop', 'banked', 'gap']

export type GateKind = 'start-finish' | 'checkpoint'

/** A gate sits on the entry edge of segment `segment` (index into Track.segments). */
export interface Gate {
  kind: GateKind
  segment: number
}

/** Medal target lap times in ms; author is the fastest. */
export interface Medals {
  author: number
  gold: number
  silver: number
  bronze: number
}

/** Special patches of road: turbo pads (yellow = short boost, red = strong) and low-grip surfaces. */
export type ZoneKind = 'turbo' | 'turbo-red' | 'dirt' | 'ice' | 'grass'

export const ZONE_KINDS: readonly ZoneKind[] = ['turbo', 'turbo-red', 'dirt', 'ice', 'grass']

/** Segment types a zone may lie on: planar strips, so the patch is a flat quad on the road. */
export const ZONE_SEGMENTS: readonly SegmentType[] = ['straight', 'ramp', 'drop']

/** A full-width patch on segment `segment`, from fraction `from` to `to` (0..1) of its length. */
export interface Zone {
  kind: ZoneKind
  segment: number
  from: number
  to: number
  /** Turbo pads only: the arrow points against the segment's direction (default: along it). */
  reverse?: boolean
}

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

export interface Track {
  name: string
  start: Pose
  segments: Segment[]
  gates: Gate[]
  /** Optional: not part of layoutId, so retuning medals keeps existing records. */
  medals?: Medals
  zones?: Zone[]
  barriers?: Barrier[]
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
