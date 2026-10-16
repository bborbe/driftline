// Curb stripes and road edge lines: alternating red/white blocks on both curb tops and a white
// line on the asphalt just inside each curb, so the road edge reads at speed. They are decals over
// the road the track already draws (Kenney pieces and procedural segments share PROFILE), placed
// with the same sampleSegment()/lateralPoint() the road mesh uses — banked turns included.
import * as THREE from 'three/webgpu'
import { poses, turnSign, type Segment, type Track } from '../../track/schema'
import { CURB_RED, CURB_WHITE } from '../look'
import { lateralPoint, PROFILE, sampleSegment, segmentLength } from './geometry'

const curbColumns = PROFILE.filter(([, , band]) => band === 'curb')
const roadColumns = PROFILE.filter(([, , band]) => band === 'road')
/** Lateral span of each curb top (metres from the centreline) and its height over the pose. */
export const CURB_INNER = Math.min(...curbColumns.map(([u]) => Math.abs(u)))
export const CURB_OUTER = Math.max(...curbColumns.map(([u]) => Math.abs(u)))
export const CURB_TOP = curbColumns[0][1]
const ROAD_TOP = roadColumns[0][1]
/** Length of one red or white curb block along the centreline. */
export const STRIPE_LENGTH = 2
/** White edge line on the asphalt: `inset` in from the curb, `width` wide. */
export const EDGE_LINE = { inset: 0.12, width: 0.22 } as const
/** Decals sit 3 mm over their surface and win the depth test by polygonOffset (AGENTS.md § Always hold). */
export const DECAL_LIFT = 0.003
/** Longest gap between ribbon rows, so curved stripes follow the arc. */
const ROW_STEP = 0.5

export type Ribbons = { positions: Float32Array; indices: Uint32Array }

class RibbonBuilder {
  private pos: number[] = []
  private idx: number[] = []
  /** A ribbon from lateral u0 to u1 at height h, along a segment from t0 to t1 (fractions). */
  add(entry: Parameters<typeof sampleSegment>[0], seg: Segment, u0: number, u1: number, h: number, t0: number, t1: number) {
    const len = segmentLength(seg)
    const rows = Math.max(2, Math.ceil(((t1 - t0) * len) / ROW_STEP) + 1)
    const s = turnSign(seg)
    const base = this.pos.length / 3
    for (let r = 0; r < rows; r++) {
      const p = sampleSegment(entry, seg, t0 + ((t1 - t0) * r) / (rows - 1))
      for (const u of [u0, u1]) {
        const [x, y, z] = lateralPoint(p, u, s)
        this.pos.push(x, y + h, z)
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      const a = base + 2 * r
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  build(): Ribbons {
    return { positions: new Float32Array(this.pos), indices: new Uint32Array(this.idx) }
  }
}

/**
 * Curb blocks and edge lines for every segment: `red` holds the red blocks, `white` the white
 * blocks plus both edge lines. Blocks alternate continuously across segment joints.
 */
export const curbDecals = (track: Track): { red: Ribbons; white: Ribbons } => {
  const red = new RibbonBuilder()
  const white = new RibbonBuilder()
  const ps = poses(track)
  let parity = 0
  track.segments.forEach((seg, i) => {
    if (seg.type === 'gap') return // no road to stripe over a jump
    const n = Math.max(1, Math.round(segmentLength(seg) / STRIPE_LENGTH))
    for (let k = 0; k < n; k++) {
      const into = (parity + k) % 2 === 0 ? red : white
      for (const side of [1, -1]) into.add(ps[i], seg, side * CURB_INNER, side * CURB_OUTER, CURB_TOP + DECAL_LIFT, k / n, (k + 1) / n)
    }
    parity = (parity + n) % 2
    for (const side of [1, -1]) {
      const outer = CURB_INNER - EDGE_LINE.inset
      white.add(ps[i], seg, side * (outer - EDGE_LINE.width), side * outer, ROAD_TOP + DECAL_LIFT, 0, 1)
    }
  })
  return { red: red.build(), white: white.build() }
}

const DECAL = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false, side: THREE.DoubleSide } as const

/** Red (or the theme's accent) and white ribbons as one vertex-coloured mesh: one draw call for every curb on the lap. */
export const createCurbs = (track: Track, accent: THREE.Color = CURB_RED): THREE.Mesh => {
  const { red, white } = curbDecals(track)
  const vertices = (red.positions.length + white.positions.length) / 3
  const positions = new Float32Array(vertices * 3)
  positions.set(red.positions)
  positions.set(white.positions, red.positions.length)
  const colors = new Float32Array(vertices * 3)
  for (let v = 0; v < vertices; v++) (v < red.positions.length / 3 ? accent : CURB_WHITE).toArray(colors, v * 3)
  const offset = red.positions.length / 3
  const indices = new Uint32Array(red.indices.length + white.indices.length)
  indices.set(red.indices)
  indices.set(white.indices.map((k) => k + offset), red.indices.length)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...DECAL, vertexColors: true, roughness: 0.55 }))
  mesh.name = 'curbs'
  mesh.receiveShadow = true
  mesh.renderOrder = 1 // after the road (decals write no depth); surface patches and pads draw over it
  return mesh
}
