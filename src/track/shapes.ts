// Shapes built on the track format: gate lines and pillars, barrier walls and posts, zone quads,
// pad arrows. Each is the single source for both its collider (src/physics) and its mesh
// (src/render). Pure TypeScript: no three, no browser APIs.
import { exitPose, partialPose, poses, segmentLength } from './pose'
import { CELL, START_ARCH_FRACTION, tileLength, type Gate, type Pose, type Track, type Zone } from './schema'

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
 * the arch (src/render). Checkpoints sit on their segment's entry edge; a start/finish gate
 * on a straight sits under the start tile's arch.
 */
export function gateLine(track: Track, gate: Gate): Pose {
  const entry = poses(track)[gate.segment]
  const seg = track.segments[gate.segment]
  if (gate.kind !== 'start-finish' || seg.type !== 'straight') return entry
  return exitPose(entry, { type: 'straight', length: tileLength(seg.length) * START_ARCH_FRACTION })
}

/**
 * Gate pillar footprint, measured from the Kenney start model (assets/pieces): each pillar spans
 * 5.17–6.30 m either side of the centreline and 1.9 m along the track.
 */
export const GATE_PILLAR = { offset: 5.735, halfWidth: 0.565, halfDepth: 0.95, height: 6.7 } as const

/**
 * Checkpoint pillar footprint, measured from assets/pieces/checkpoint.glb (render/track/kenney.test.ts):
 * its legs are wider than the start arch's, 5.0–6.3 m either side of the centreline and 1.9 m along.
 */
export const CHECKPOINT_PILLAR = { offset: 5.65, halfWidth: 0.65, halfDepth: 0.95, height: 6.7 } as const

/** Lowest gate base whose legs are carried down to the ground (the arch's legs, gateLegs). */
export const GATE_LEG_MIN_HEIGHT = 1

/** A solid gate pillar: an upright box centred on (x, z), standing on y, rotated by heading. */
export interface Pillar extends Pose {
  halfWidth: number
  halfDepth: number
  height: number
}

/**
 * Both pillars of a gate — the single source for the pillar colliders (src/physics) and the
 * procedural arch (src/render). A start/finish arch stands on its gate line; a checkpoint
 * model's pillars start at the segment's entry edge, so they centre halfDepth past it.
 */
export function gatePillars(track: Track, gate: Gate): Pillar[] {
  const line = gateLine(track, gate)
  const section = gate.kind === 'checkpoint' ? CHECKPOINT_PILLAR : GATE_PILLAR
  const along = gate.kind === 'checkpoint' ? section.halfDepth : 0
  const fx = Math.sin(line.heading)
  const fz = Math.cos(line.heading)
  return [-1, 1].map((side) => ({
    x: line.x + fx * along + fz * side * section.offset,
    y: line.y,
    z: line.z + fz * along - fx * side * section.offset,
    heading: line.heading,
    halfWidth: section.halfWidth,
    halfDepth: section.halfDepth,
    height: section.height,
  }))
}

/**
 * The legs under an elevated gate (base GATE_LEG_MIN_HEIGHT or more up): each pillar continued in its
 * own section from the ground to the gate's base, as the arch draws them (render/track/mesh.ts gateArch,
 * kenney.ts createGateLegs). A car driving under the deck hits them like the pillars above.
 */
export function gateLegs(track: Track, gate: Gate): Pillar[] {
  return gatePillars(track, gate)
    .filter((p) => p.y >= GATE_LEG_MIN_HEIGHT)
    .map((p) => ({ ...p, y: 0, height: p.y }))
}

// Each barrier as the [x, z] points of its wall line: a road-following one is sampled every
// BARRIER.step metres or less along its piece, offset from the centreline to the wall's middle.
function barrierLines(track: Track): [number, number][][] {
  const entries = poses(track)
  return (track.barriers ?? []).map((b) => {
    if (!('segment' in b)) return [b.from, b.to]
    const seg = track.segments[b.segment]
    const from = b.from ?? 0
    const to = b.to ?? 1
    const length = segmentLength(seg)
    const n = Math.max(1, Math.ceil((length * (to - from)) / BARRIER.step))
    const offset = (b.side === 'left' ? 1 : -1) * (CELL / 2 + (b.gap ?? BARRIER.gap) + BARRIER.halfWidth)
    return Array.from({ length: n + 1 }, (_, k) => {
      const p = partialPose(entries[b.segment], seg, from + ((to - from) * k) / n)
      // Heading 0 faces +z with +x on the left.
      return [p.x + Math.cos(p.heading) * offset, p.z - Math.sin(p.heading) * offset] as [number, number]
    })
  })
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
