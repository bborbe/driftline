// Neon Night tubes: a glowing hexagonal tube floating just above every edge rail, yellow along the
// rails on one side of the road and pink on the other. Swept along railRuns() — the same rows the rail
// and its collider come from (render/track/rails.ts, src/track/rails.ts) — so a tube never leaves its
// rail. One mesh per colour: two draw calls for the whole lap. Pure geometry plus one material each.
import * as THREE from 'three/webgpu'
import { RAIL, railRuns, type RailPoint } from '../../track/rails'
import type { Track } from '../../track/schema'
import { EMISSIVE, NEON_GLOW, tagGlow } from '../glow'

/** Tube section: radius, sides, and its centre's height over the rail top. */
export const TUBE = { radius: 0.07, sides: 6, lift: 0.2 } as const

type Vec = [number, number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** The tube's centreline for one rail run: over the middle of each row's rail top. */
export const tubeLine = (rows: [RailPoint, RailPoint][]): Vec[] =>
  rows.map(([i, o]) => [(i[0] + o[0]) / 2, (i[1] + o[1]) / 2 + RAIL.height + TUBE.lift, (i[2] + o[2]) / 2])

/** Tubes over every rail on `side` (1 or -1) as triangle soup: a TUBE.sides-gon swept along each run's tubeLine. */
export const tubeGeometry = (track: Track, side: 1 | -1): Float32Array => {
  const out: number[] = []
  for (const run of railRuns(track)) {
    if (run.side !== side || run.rows.length < 2) continue
    const line = tubeLine(run.rows)
    const rings = line.map((c, k) => {
      const t = unit(sub(line[Math.min(k + 1, line.length - 1)], line[Math.max(k - 1, 0)]))
      // A frame across the tangent: n roughly horizontal, b roughly up (the rails never run vertical).
      const n = unit(cross(t, [0, 1, 0]))
      const b = cross(n, t)
      return Array.from({ length: TUBE.sides }, (_, s): Vec => {
        const a = (s / TUBE.sides) * Math.PI * 2
        const [cos, sin] = [Math.cos(a) * TUBE.radius, Math.sin(a) * TUBE.radius]
        return [c[0] + n[0] * cos + b[0] * sin, c[1] + n[1] * cos + b[1] * sin, c[2] + n[2] * cos + b[2] * sin]
      })
    })
    for (let r = 0; r < rings.length - 1; r++)
      for (let s = 0; s < TUBE.sides; s++) {
        const s1 = (s + 1) % TUBE.sides
        const [a, b, c, d] = [rings[r][s], rings[r + 1][s], rings[r + 1][s1], rings[r][s1]]
        out.push(...a, ...b, ...c, ...a, ...c, ...d)
      }
  }
  return new Float32Array(out)
}

const tubeMaterial = (hex: number): THREE.MeshStandardMaterial =>
  tagGlow(new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: EMISSIVE['neon-tube'], roughness: 0.3, side: THREE.DoubleSide }), 'neon-tube')

/** Yellow tubes over the side-1 rails and pink ones over the side -1 rails. */
export const createNeonTubes = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'neon-tubes'
  for (const [side, hex] of [
    [1, NEON_GLOW.yellow],
    [-1, NEON_GLOW.pink],
  ] as const) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(tubeGeometry(track, side), 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, tubeMaterial(hex))
    mesh.name = side === 1 ? 'neon-tube-yellow' : 'neon-tube-pink'
    mesh.castShadow = false
    group.add(mesh)
  }
  return group
}
