// Steel truss under a bridge: each deck pillar (planDeckPillars) is drawn as four corner legs tied by
// struts and one diagonal per face and bay, instead of a solid box. Visual only: the collider stays the
// pillar's own square box (pillarBoxes, src/track/bodies.ts), and every member is drawn inside it.
// Pure: the members are boxes, placed by createRampSupports (mesh.ts) as two instanced meshes.
import { DECK_PILLAR_SIZE, type DeckPillar } from '../../track/bodies'

/** Corner leg section; the legs' outer faces sit on the collider's faces. */
export const TRUSS_LEG = 0.26
/** Strut and diagonal section: above MIN_THICKNESS (render/lint.ts). */
export const TRUSS_BRACE = 0.16
/** Target bay height: one strut and one diagonal per face every this many metres. */
export const TRUSS_BAY = 3

/**
 * One member: a box centred at (x, y, z), sized (sx, sy, sz), turned by `roll` about `axis` — the
 * normal of the face it lies in (`z`: a face looking along ±z, members run along x; `x`: the other two).
 */
export type TrussMember = { x: number; y: number; z: number; sx: number; sy: number; sz: number; axis: 'x' | 'z'; roll: number }

export type Truss = { legs: TrussMember[]; braces: TrussMember[] }

export const planTruss = (p: DeckPillar): Truss => {
  const c = DECK_PILLAR_SIZE / 2 - TRUSS_LEG / 2 // leg centre offset from the pillar's centre
  const legs: TrussMember[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push({ x: p.x + sx * c, y: p.top / 2, z: p.z + sz * c, sx: TRUSS_LEG, sy: p.top, sz: TRUSS_LEG, axis: 'z', roll: 0 })
  const bays = Math.max(1, Math.round(p.top / TRUSS_BAY))
  const h = p.top / bays
  // Diagonals rise TRUSS_BRACE short of each bay's ends, so their corners stay between ground and deck.
  const rise = h - 2 * TRUSS_BRACE
  const len = Math.hypot(2 * c, rise)
  const angle = Math.atan2(rise, 2 * c)
  const braces: TrussMember[] = []
  for (const [axis, side] of [['z', -1], ['z', 1], ['x', -1], ['x', 1]] as const) {
    // A member in this face, centred on its middle at height y.
    const at = (y: number, length: number, roll: number): TrussMember =>
      axis === 'z'
        ? { x: p.x, y, z: p.z + side * c, sx: length, sy: TRUSS_BRACE, sz: TRUSS_BRACE, axis, roll }
        : { x: p.x + side * c, y, z: p.z, sx: TRUSS_BRACE, sy: TRUSS_BRACE, sz: length, axis, roll }
    // Struts at every bay joint, then one diagonal per bay, leg centre to leg centre, alternating.
    for (let k = 1; k < bays; k++) braces.push(at(k * h, 2 * c, 0))
    for (let k = 0; k < bays; k++) braces.push(at((k + 0.5) * h, len, k % 2 === 0 ? angle : -angle))
  }
  return { legs, braces }
}

/** The member's rotation (right-handed `roll` about its `axis`, as Quaternion.setFromAxisAngle) applied to a local offset. */
export const rotateMember = (m: TrussMember, [lx, ly, lz]: [number, number, number]): [number, number, number] => {
  const cos = Math.cos(m.roll)
  const sin = Math.sin(m.roll)
  return m.axis === 'z' ? [lx * cos - ly * sin, lx * sin + ly * cos, lz] : [lx, ly * cos - lz * sin, ly * sin + lz * cos]
}

/** The member's eight corners in world space. */
export const memberCorners = (m: TrussMember): [number, number, number][] => {
  const out: [number, number, number][] = []
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const d of [-1, 1]) {
    const [x, y, z] = rotateMember(m, [(a * m.sx) / 2, (b * m.sy) / 2, (d * m.sz) / 2])
    out.push([m.x + x, m.y + y, m.z + z])
  }
  return out
}
