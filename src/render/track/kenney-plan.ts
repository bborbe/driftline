// Plans where the normalized Kenney pieces (assets/pieces/*.glb) go on a track.
// Pure TypeScript: no three, so placements are unit-testable.
// Piece convention (scripts/build-pieces.mjs): entry edge bottom-center at the origin,
// running along +z, so a piece sits at a schema Pose with rotation.y = heading.
import { exitPose, GATE_LEG_MIN_HEIGHT, poses, ROAD_WIDTH, TILE_LENGTH, tileLength, type Pose, type Segment, type Track } from '../../track/schema'

/** Native dimensions of the normalized pieces, from assets/track/pieces.json. */
const STRAIGHT_LENGTH = TILE_LENGTH
const CORNER_RADIUS = 15 // the corner piece turns RIGHT at this radius

/** Road width of every normalized piece at scale 1, in metres: the one ROAD_WIDTH (src/track/pose.ts). */
export const PIECE_ROAD_WIDTH = ROAD_WIDTH

/** Road width a placement actually draws: only an x scale changes it. */
export const placedRoadWidth = (p: Placement): number => PIECE_ROAD_WIDTH * Math.abs(p.scale[0])

export type Placement = {
  piece: string // file stem under assets/pieces/
  pose: Pose
  scale: [number, number, number] // x < 0 mirrors a right-turn piece into a left turn
}

export type PiecePlan = {
  placements: Placement[]
  /** Segment indices with no piece mapping; render these procedurally. */
  procedural: number[]
  /** Gate indices with no piece; render these as procedural arches. */
  proceduralGates: number[]
}

const quarter = (turn: 'left' | 'right', radius: number): Segment => ({ type: 'curve', turn, radius, angle: 90 })

/** Pieces for one segment, or null when no piece fits it. */
const planSegment = (entry: Pose, seg: Segment, startLine: boolean): Placement[] | null => {
  switch (seg.type) {
    case 'straight': {
      const len = tileLength(seg.length)
      const n = Math.round(seg.length / len)
      return Array.from({ length: n }, (_, i) => ({
        piece: startLine && i === 0 ? 'start' : 'straight',
        pose: exitPose(entry, { type: 'straight', length: i * len }),
        scale: [1, 1, len / STRAIGHT_LENGTH] as [number, number, number],
      }))
    }
    case 'gap':
      return [] // nothing to draw: the jump is the absence of road
    case 'ramp':
    case 'drop':
    case 'loop':
    case 'wallride':
      // Procedural: the Kenney ramp's curved profile matched neither the physics strip
      // (linear) nor the support walls, leaving a step at the foot and walls poking out.
      return null
    case 'curve':
    case 'hairpin':
    case 'banked': {
      // banked.glb is generated geometry with no material or normals, so it renders
      // as nothing visible; banked turns use the procedural mesh instead.
      if (seg.type === 'banked') return null
      const angle = seg.type === 'hairpin' ? 180 : seg.angle
      if (angle % 90 !== 0) return null
      // Scaling the corner piece would scale its road width with it (a 30 m radius would
      // give a 20 m road), so only its native radius uses the piece; other radii are procedural.
      if (Math.abs(seg.radius - CORNER_RADIUS) > 1e-6) return null
      const piece = 'corner'
      const k = 1
      const out: Placement[] = []
      let p = entry
      for (let i = 0; i < angle / 90; i++) {
        out.push({ piece, pose: p, scale: [seg.turn === 'left' ? -k : k, 1, k] })
        p = exitPose(p, quarter(seg.turn, seg.radius))
      }
      return out
    }
  }
}

export const planPieces = (track: Track): PiecePlan => {
  const ps = poses(track)
  const startSegs = new Set(track.gates.filter((g) => g.kind === 'start-finish').map((g) => g.segment))
  const placements: Placement[] = []
  const procedural: number[] = []
  const proceduralGates: number[] = []

  track.segments.forEach((seg, i) => {
    const planned = planSegment(ps[i], seg, startSegs.has(i))
    if (planned) placements.push(...planned)
    else procedural.push(i)
  })

  track.gates.forEach((gate, i) => {
    if (gate.kind === 'checkpoint' && gate.at) {
      // Part-way along a segment (a loop's top): the piece model stands on an entry edge, so an arch.
      proceduralGates.push(i)
    } else if (gate.kind === 'checkpoint') {
      placements.push({ piece: 'checkpoint', pose: ps[gate.segment], scale: [1, 1, 1] })
    } else if (track.segments[gate.segment].type !== 'straight') {
      // The start piece is a straight tile; elsewhere fall back to an arch.
      proceduralGates.push(i)
    }
  })
  return { placements, procedural, proceduralGates }
}

/**
 * The checkpoint piece's legs, measured from assets/pieces/checkpoint.glb: straight boxes from
 * the piece origin up to the arch, 5.0–6.3 m either side of the centreline and 0–1.9 m along.
 * This is the drawn leg; the collider (GATE_PILLAR) is 0.17 m narrower on the road side and stays as it is.
 */
export const CHECKPOINT_LEG = { inner: 5, outer: 6.3, depth: 1.9 } as const

/** Lowest checkpoint base that gets its legs carried down to the ground. */
export { GATE_LEG_MIN_HEIGHT }

/** A leg carried from the ground up to the base of an elevated checkpoint piece: an upright box centred on (x, z). */
export type GateLeg = { x: number; z: number; heading: number; halfWidth: number; halfDepth: number; height: number }

/**
 * The legs of every checkpoint piece placed on an elevated deck, continued from the ground up to
 * the piece's base in the leg's own cross-section, so the leg reads as one column through the
 * deck line. The inner face is the road edge (TRACK_WIDTH / 2), flush with the deck's side wall.
 */
export const planGateLegs = (plan: PiecePlan): GateLeg[] =>
  plan.placements
    .filter((p) => p.piece === 'checkpoint' && p.pose.y >= GATE_LEG_MIN_HEIGHT)
    .flatMap(({ pose }) => {
      const fx = Math.sin(pose.heading)
      const fz = Math.cos(pose.heading)
      const along = CHECKPOINT_LEG.depth / 2
      const offset = (CHECKPOINT_LEG.inner + CHECKPOINT_LEG.outer) / 2
      return [-1, 1].map((side) => ({
        x: pose.x + fx * along + fz * side * offset,
        z: pose.z + fz * along - fx * side * offset,
        heading: pose.heading,
        halfWidth: (CHECKPOINT_LEG.outer - CHECKPOINT_LEG.inner) / 2,
        halfDepth: along,
        height: pose.y,
      }))
    })
