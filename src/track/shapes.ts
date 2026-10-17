// Shapes built on the track format: gate lines and pillars, barrier walls and posts, zone quads,
// pad arrows. Each is the single source for both its collider (src/physics) and its mesh
// (src/render). Pure TypeScript: no three, no browser APIs.
import { exitPose, partialPose, poses, segmentLength, widthAt } from './pose'
import { CELL, START_ARCH_FRACTION, tileLength, type Gate, type Pad, type Pose, type Track, type Zone } from './schema'

/**
 * Unit horizontal direction a turbo pad's arrow points, as [x, z] — the single source for the
 * boost check (src/physics) and the chevrons (src/render). Along the segment unless `reverse`.
 */
export function padForward(track: Track, zone: Zone): [number, number] {
  const heading = poses(track)[zone.segment].heading
  const s = zone.reverse ? -1 : 1
  return [s * Math.sin(heading), s * Math.cos(heading)]
}

/**
 * Barrier shape in metres: a low red wall with a white top, in straight lengths of at most `step`,
 * a square white post at every end and joint. `gap` (curb to wall face) is below the car's width,
 * so a wall that ends at the road edge closes the way through.
 */
export const BARRIER = { halfWidth: 0.5, height: 1.2, gap: 1.5, step: 5, post: 0.55, postHeight: 1.35 } as const

/**
 * Where a gate's line actually is — the single source for the lap trigger (src/race) and
 * the arch (src/render). Checkpoints sit on their segment's entry edge, or `at` of the way along
 * it (a loop's top); a start/finish gate on a straight sits under the start tile's arch.
 */
export function gateLine(track: Track, gate: Gate): Pose {
  const entry = poses(track)[gate.segment]
  const seg = track.segments[gate.segment]
  if (gate.at !== undefined && gate.at > 0) return partialPose(entry, seg, gate.at)
  if (gate.kind !== 'start-finish' || seg.type !== 'straight') return entry
  return exitPose(entry, { type: 'straight', length: tileLength(seg.length) * START_ARCH_FRACTION })
}

/**
 * Gate pillar footprint on a road CELL (10 m) wide, measured from the Kenney start/checkpoint models
 * (assets/pieces): each pillar spans 5.17–6.30 m either side of the centreline and 1.9 m along the track.
 * The checkpoint model's drawn legs start at 5.0 m (render/track/kenney-plan.ts CHECKPOINT_LEG);
 * the collider stays at 5.17 so the racing lines keep clear (the lint's COLLIDER_TOLERANCE covers it).
 * On a wider or narrower road the gate is the same model stretched across (gateScale): its legs move
 * out with the road edge and widen; depth and height do not change.
 */
export const GATE_PILLAR = { offset: 5.735, halfWidth: 0.565, halfDepth: 0.95, height: 6.7 } as const
/** Inner face of the models' drawn legs on a CELL-wide road (kenney-plan.ts CHECKPOINT_LEG.inner): stretched, the collider keeps its 0.17 m inset from it. */
const DRAWN_LEG_INNER = 5

/** Road width (m) under a gate's line: the segment's width there (widthAt). */
export function gateWidth(track: Track, gate: Gate): number {
  const seg = track.segments[gate.segment]
  if (gate.at !== undefined && gate.at > 0) return widthAt(seg, gate.at)
  if (gate.kind !== 'start-finish' || seg.type !== 'straight') return widthAt(seg, 0)
  return widthAt(seg, (tileLength(seg.length) * START_ARCH_FRACTION) / seg.length)
}

/** Sideways stretch of a gate model built for a CELL-wide road, so its legs stand just off the road's edge. */
export const gateScale = (track: Track, gate: Gate): number => gateWidth(track, gate) / CELL

/** Lowest gate base whose legs are carried down to the ground (the arch's legs, gateLegs). */
export const GATE_LEG_MIN_HEIGHT = 1

/**
 * Which way a gate stands: 1 upright on its road, -1 hanging from it — a gate over the top half of
 * a loop, where the car drives upside down beneath the road. The single source for the lap
 * trigger's height window (src/race), the pillar colliders and the arch.
 */
export function gateUp(track: Track, gate: Gate): 1 | -1 {
  const at = gate.at ?? 0
  return track.segments[gate.segment]?.type === 'loop' && at > 0.25 && at < 0.75 ? -1 : 1
}

/** A solid gate pillar: an upright box centred on (x, z), standing on y, rotated by heading. */
export interface Pillar extends Pose {
  halfWidth: number
  halfDepth: number
  height: number
}

/**
 * Both pillars of a gate — the single source for the pillar colliders (src/physics) and the
 * procedural arch (src/render). A start/finish arch stands on its gate line; a checkpoint
 * model's pillars start at the segment's entry edge, so they centre halfDepth past it. A
 * hanging gate (gateUp -1) has its pillars run down from the road, so their box base is below it.
 */
export function gatePillars(track: Track, gate: Gate): Pillar[] {
  const line = gateLine(track, gate)
  const section = GATE_PILLAR
  const base = gateUp(track, gate) === 1 ? line.y : line.y - section.height
  const k = gateScale(track, gate)
  // The drawn leg stretches with the road (k); the collider keeps the same inset inside it.
  const outer = (section.offset + section.halfWidth) * k
  const inner = section.offset - section.halfWidth + DRAWN_LEG_INNER * (k - 1)
  const along = gate.kind === 'checkpoint' ? section.halfDepth : 0
  const fx = Math.sin(line.heading)
  const fz = Math.cos(line.heading)
  return [-1, 1].map((side) => ({
    x: line.x + fx * along + (fz * side * (outer + inner)) / 2,
    y: base,
    z: line.z + fz * along - (fx * side * (outer + inner)) / 2,
    heading: line.heading,
    halfWidth: (outer - inner) / 2,
    halfDepth: section.halfDepth,
    height: section.height,
  }))
}

/**
 * The legs under an elevated gate (base GATE_LEG_MIN_HEIGHT or more up): each pillar continued in its
 * own section from the ground to the gate's base, as the arch draws them (render/track/mesh.ts gateArch,
 * kenney.ts createGateLegs). A car driving under the deck hits them like the pillars above. A
 * hanging gate has none: it hangs from the loop's road, and a leg there would stand in the run-in.
 */
export function gateLegs(track: Track, gate: Gate): Pillar[] {
  if (gateUp(track, gate) === -1) return []
  return gatePillars(track, gate)
    .filter((p) => p.y >= GATE_LEG_MIN_HEIGHT)
    .map((p) => ({ ...p, y: 0, height: p.y }))
}

// Each barrier as the [x, z] points of its wall line: a road-following one is sampled every
// BARRIER.step metres or less along its piece, offset from the road edge there (widthAt) to the wall's middle.
/** True when (x, z) lies on the pad's asphalt, shrunk by `margin` metres on every side (negative grows it). */
export const onPad = (pad: Pad, x: number, z: number, margin = 0): boolean => {
  const half = pad.size / 2 - margin
  return Math.abs(x - pad.centre[0]) <= half && Math.abs(z - pad.centre[1]) <= half
}

/** Length of one pad wall piece: each edge is split into these, so no collider box is hundreds of metres long. */
const PAD_WALL_STEP = 20

/** The pad's four edge walls, their inner face on the asphalt's edge: lines of [x, z] points, clockwise from the -x/-z corner. */
export function padWalls(pad: Pad): [number, number][][] {
  const h = pad.size / 2 + BARRIER.halfWidth
  const [cx, cz] = pad.centre
  const corners: [number, number][] = [[cx - h, cz - h], [cx - h, cz + h], [cx + h, cz + h], [cx + h, cz - h]]
  const n = Math.max(1, Math.ceil((2 * h) / PAD_WALL_STEP))
  return corners.map(([x0, z0], i) => {
    const [x1, z1] = corners[(i + 1) % 4]
    return Array.from({ length: n + 1 }, (_, k) => [x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n] as [number, number])
  })
}

/** Distance marks along the pad's lane: the [x, z] centre of a mark every `lane.marks` metres from its start, ends included. */
export function padLaneMarks(pad: Pad): [number, number][] {
  const { from, to, marks } = pad.lane
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const n = Math.floor(length / marks + 1e-9)
  return Array.from({ length: n + 1 }, (_, k) => {
    const f = (k * marks) / length
    return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f] as [number, number]
  })
}

function barrierLines(track: Track): [number, number][][] {
  const entries = poses(track)
  return [...(track.barriers ?? []).map((b) => {
    if (!('segment' in b)) return [b.from, b.to]
    const seg = track.segments[b.segment]
    const from = b.from ?? 0
    const to = b.to ?? 1
    const length = segmentLength(seg)
    const n = Math.max(1, Math.ceil((length * (to - from)) / BARRIER.step))
    const side = b.side === 'left' ? 1 : -1
    return Array.from({ length: n + 1 }, (_, k) => {
      const f = from + ((to - from) * k) / n
      const p = partialPose(entries[b.segment], seg, f)
      const offset = side * (widthAt(seg, f) / 2 + (b.gap ?? BARRIER.gap) + BARRIER.halfWidth)
      // Heading 0 faces +z with +x on the left.
      return [p.x + Math.cos(p.heading) * offset, p.z - Math.sin(p.heading) * offset] as [number, number]
    })
  }), ...(track.pad ? padWalls(track.pad) : [])]
}

/** Every barrier wall length as an upright box — the single source for the colliders (src/physics) and the walls (src/render). */
export function barrierPillars(track: Track): Pillar[] {
  return barrierLines(track).flatMap((line) =>
    line.slice(1).map(([x1, z1], k) => {
      const [x0, z0] = line[k]
      return {
        x: (x0 + x1) / 2,
        y: 0,
        z: (z0 + z1) / 2,
        heading: Math.atan2(x1 - x0, z1 - z0),
        halfWidth: BARRIER.halfWidth,
        halfDepth: Math.hypot(x1 - x0, z1 - z0) / 2,
        height: BARRIER.height,
      }
    }),
  )
}

/** A post at every barrier end and joint, as an upright box — colliders and render alike. */
export function barrierPosts(track: Track): Pillar[] {
  return barrierLines(track).flatMap((line) =>
    line.map(([x, z], k) => {
      const [ax, az] = line[Math.max(0, k - 1)]
      const [bx, bz] = line[Math.min(line.length - 1, k + 1)]
      return { x, y: 0, z, heading: Math.atan2(bx - ax, bz - az), halfWidth: BARRIER.post, halfDepth: BARRIER.post, height: BARRIER.postHeight }
    }),
  )
}

/** Corners of a zone's quad on the road: [left, right] at `from`, then [left, right] at `to`. */
export function zoneCorners(track: Track, zone: Zone, width: number): Pose[] {
  const entry = poses(track)[zone.segment]
  const seg = track.segments[zone.segment]
  const length = 'length' in seg ? seg.length : 0
  const dy = seg.type === 'ramp' ? seg.rise : seg.type === 'drop' ? -seg.fall : 0
  const fx = Math.sin(entry.heading)
  const fz = Math.cos(entry.heading)
  const out: Pose[] = []
  for (const f of [zone.from, zone.to]) {
    for (const side of [1, -1]) {
      out.push({
        x: entry.x + fx * length * f + fz * side * (width / 2),
        y: entry.y + dy * f,
        z: entry.z + fz * length * f - fx * side * (width / 2),
        heading: entry.heading,
      })
    }
  }
  return out
}
