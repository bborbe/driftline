// Plans where the normalized Kenney pieces (assets/pieces/*.glb) go on a track.
// Pure TypeScript: no three, so placements are unit-testable.
// Piece convention (scripts/build-pieces.mjs): entry edge bottom-center at the origin,
// running along +z, so a piece sits at a schema Pose with rotation.y = heading.
import { exitPose, poses, TILE_LENGTH, tileLength, type Pose, type Segment, type Track } from '../../track/schema'

/** Native dimensions of the normalized pieces, from assets/track/pieces.json. */
const STRAIGHT_LENGTH = TILE_LENGTH
const CORNER_RADIUS = 15 // the corner piece turns RIGHT at this radius

/** Road width of every normalized piece at scale 1, in metres (TRACK_WIDTH in geometry.ts matches). */
export const PIECE_ROAD_WIDTH = 10

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

const advance = (p: Pose, d: number): Pose => ({
  ...p,
  x: p.x + Math.sin(p.heading) * d,
  z: p.z + Math.cos(p.heading) * d,
})

const quarter = (turn: 'left' | 'right', radius: number): Segment => ({ type: 'curve', turn, radius, angle: 90 })

/** Pieces for one segment, or null when no piece fits it. */
const planSegment = (entry: Pose, seg: Segment, startLine: boolean): Placement[] | null => {
  switch (seg.type) {
    case 'straight': {
      const len = tileLength(seg.length)
      const n = Math.round(seg.length / len)
      return Array.from({ length: n }, (_, i) => ({
        piece: startLine && i === 0 ? 'start' : 'straight',
        pose: advance(entry, i * len),
        scale: [1, 1, len / STRAIGHT_LENGTH] as [number, number, number],
      }))
    }
    case 'ramp':
    case 'drop':
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
    if (gate.kind === 'checkpoint') {
      placements.push({ piece: 'checkpoint', pose: ps[gate.segment], scale: [1, 1, 1] })
    } else if (track.segments[gate.segment].type !== 'straight') {
      // The start piece is a straight tile; elsewhere fall back to an arch.
      proceduralGates.push(i)
    }
  })
  return { placements, procedural, proceduralGates }
}
