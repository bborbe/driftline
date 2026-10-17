// Edge rails and their neon lines: the white rail swept along railRuns() — the same rows the physics
// builds its rail boxes from (src/track/rails.ts railBoxes) — and a cyan emissive ribbon on each rail's
// top. Emissive, so the line reads lit without a bloom pass and glows with one.
import * as THREE from 'three/webgpu'
import { NEON, RAIL, railRuns, type RailPoint } from '../../track/rails'
import type { Track } from '../../track/schema'
import { CURB_WHITE, NEON_CYAN } from '../look'
import { flat, structural } from '../tags'
import { DECAL_LIFT } from './curbs'

/** Glow of the neon line: emissive over its own colour, so it stays saturated under the sun. */
export const NEON_INTENSITY = 2

const up = (p: RailPoint, h: number): RailPoint => [p[0], p[1] + h, p[2]]

const mean = (ps: RailPoint[]): RailPoint => [0, 1, 2].map((k) => ps.reduce((sum, p) => sum + p[k], 0) / ps.length) as RailPoint

/**
 * Rail solids as triangle soup: per row pair its inner face, top, outer face and underside, plus a
 * cap at each run end. Every quad is wound to face away from the rail's middle, so its computed
 * normal points out and the white lights evenly on whichever side of the road it stands.
 */
export const railGeometry = (track: Track): Float32Array => {
  const out: number[] = []
  const quad = (inside: RailPoint, a: RailPoint, b: RailPoint, c: RailPoint, d: RailPoint) => {
    const [u, v] = [b.map((x, k) => x - a[k]), c.map((x, k) => x - a[k])]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const m = mean([a, b, c, d])
    const outward = n[0] * (m[0] - inside[0]) + n[1] * (m[1] - inside[1]) + n[2] * (m[2] - inside[2]) > 0
    out.push(...(outward ? [...a, ...b, ...c, ...a, ...c, ...d] : [...a, ...c, ...b, ...a, ...d, ...c]))
  }
  for (const { rows } of railRuns(track)) {
    const ring = rows.map(([i, o]): RailPoint[] => [i, up(i, RAIL.height), up(o, RAIL.height), o])
    for (let r = 0; r < ring.length - 1; r++) {
      const [a, b] = [ring[r], ring[r + 1]]
      const inside = mean([...a, ...b])
      for (let k = 0; k < 4; k++) quad(inside, a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4])
    }
    const [first, last] = [ring[0], ring[ring.length - 1]]
    quad(mean([...first, ...ring[1]]), first[3], first[2], first[1], first[0])
    quad(mean([...last, ...ring[ring.length - 2]]), last[0], last[1], last[2], last[3])
  }
  return new Float32Array(out)
}

/** Neon ribbons as triangle soup: NEON.width wide along the middle of each rail top, DECAL_LIFT above it. */
export const neonGeometry = (track: Track): Float32Array => {
  const out: number[] = []
  for (const { rows } of railRuns(track)) {
    const edges = rows.map(([i, o]): [RailPoint, RailPoint] => {
      const [cx, cy, cz] = [(i[0] + o[0]) / 2, (i[1] + o[1]) / 2 + RAIL.height + DECAL_LIFT, (i[2] + o[2]) / 2]
      const [dx, dz] = [o[0] - i[0], o[2] - i[2]]
      const k = NEON.width / 2 / Math.hypot(dx, dz)
      return [
        [cx - dx * k, cy, cz - dz * k],
        [cx + dx * k, cy, cz + dz * k],
      ]
    })
    for (let r = 0; r < edges.length - 1; r++) {
      const [[a, b], [c, d]] = [edges[r], edges[r + 1]]
      out.push(...a, ...c, ...d, ...a, ...d, ...b)
    }
  }
  return new Float32Array(out)
}

const soup = (positions: Float32Array): THREE.BufferGeometry => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

const railMaterial = new THREE.MeshStandardMaterial({ color: CURB_WHITE, roughness: 0.45 })
export const neonMaterial = new THREE.MeshStandardMaterial({
  color: NEON_CYAN,
  emissive: NEON_CYAN,
  emissiveIntensity: NEON_INTENSITY,
  roughness: 0.3,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  depthWrite: false,
  side: THREE.DoubleSide,
})

/** Every rail on the lap as one mesh and every neon line as another: two draw calls for the whole lap. */
export const createRails = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'rails'
  const rails = structural(new THREE.Mesh(soup(railGeometry(track)), railMaterial), 'wall')
  rails.name = 'rail'
  rails.castShadow = true
  rails.receiveShadow = true
  const neon = flat(new THREE.Mesh(soup(neonGeometry(track)), neonMaterial), 'decal')
  neon.name = 'neon'
  neon.renderOrder = 1 // after the rail (decals write no depth)
  group.add(rails, neon)
  return group
}
