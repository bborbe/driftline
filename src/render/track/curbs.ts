// Curb stripes and road edge lines: alternating red/white blocks on both curb tops and a white
// line on the asphalt just inside each curb, so the road edge reads at speed. They are decals over
// the road the track already draws (Kenney pieces and procedural segments share PROFILE), placed
// with the same sampleSegment()/lateralPoint() the road mesh uses — banked turns included.
import * as THREE from 'three/webgpu'
import { poses, SURFACE_KINDS, turnSign, type Segment, type SurfaceKind, type Track } from '../../track/schema'
import { CURB_RED, CURB_WHITE } from '../look'
import { glowMaterial } from '../glow'
import { flat } from '../tags'
import { lateralPoint, PROFILE, roadScale, sampleSegment, segmentLength } from './geometry'

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
  /** A ribbon from lateral u0 to u1 (on a CELL-wide road; stretched by roadScale) at height h, along a segment from t0 to t1 (fractions). */
  add(entry: Parameters<typeof sampleSegment>[0], seg: Segment, u0: number, u1: number, h: number, t0: number, t1: number) {
    const len = segmentLength(seg)
    const rows = Math.max(2, Math.ceil(((t1 - t0) * len) / ROW_STEP) + 1)
    const s = turnSign(seg)
    const base = this.pos.length / 3
    for (let r = 0; r < rows; r++) {
      const t = t0 + ((t1 - t0) * r) / (rows - 1)
      const p = sampleSegment(entry, seg, t)
      const k = roadScale(seg, t)
      for (const u of [u0, u1]) {
        const [x, y, z] = lateralPoint(p, u * k, s)
        this.pos.push(x, y + h, z)
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      const a = base + 2 * r
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  get indexCount(): number {
    return this.idx.length
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
    if (seg.type === 'gap' || seg.type === 'loop') return // no road to stripe over a jump; a loop's curbs are in its mesh (PROFILE)
    const n = Math.max(1, Math.round(segmentLength(seg) / STRIPE_LENGTH))
    for (let k = 0; k < n; k++) {
      const into = (parity + k) % 2 === 0 ? red : white
      for (const side of [1, -1]) into.add(ps[i], seg, side * CURB_INNER, side * CURB_OUTER, CURB_TOP + DECAL_LIFT, k / n, (k + 1) / n)
    }
    parity = (parity + n) % 2
    addEdgeLines(white, ps[i], seg)
  })
  return { red: red.build(), white: white.build() }
}

const addEdgeLines = (into: RibbonBuilder, entry: Parameters<typeof sampleSegment>[0], seg: Segment, lift = DECAL_LIFT) => {
  const outer = CURB_INNER - EDGE_LINE.inset
  for (const side of [1, -1]) into.add(entry, seg, side * (outer - EDGE_LINE.width), side * outer, ROAD_TOP + lift, 0, 1)
}

/** The two edge lines alone, one DECAL_LIFT above the painted ones: the neon (createEdgeLines) draws over them. */
export const edgeLines = (track: Track): Ribbons => {
  const lines = new RibbonBuilder()
  const ps = poses(track)
  track.segments.forEach((seg, i) => {
    if (seg.type !== 'gap' && seg.type !== 'loop') addEdgeLines(lines, ps[i], seg, 2 * DECAL_LIFT)
  })
  return lines.build()
}

/** Dashed centre line: DASH.length of white, then DASH.gap of asphalt, continuous across segment joints. */
export const DASH = { length: 3, gap: 3, width: 0.15 } as const
/** Trim strip across the asphalt where a surface patch (dirt, ice, grass) begins or ends: `length` along the road. */
export const TRIM = { length: 0.4 } as const
/** Half-width of the trim strips: the asphalt between the edge lines. */
export const TRIM_HALF_WIDTH = CURB_INNER - EDGE_LINE.inset - EDGE_LINE.width

/** `dashIndices`: the first that many indices are the dashes, the rest the trim strips. */
export type Markings = Ribbons & { dashes: number; strips: number; dashIndices: number }

/** Centre dashes on every road segment and a trim strip at each surface patch's start and end, as one set of white ribbons. */
export const roadMarkings = (track: Track): Markings => {
  const out = new RibbonBuilder()
  const ps = poses(track)
  const period = DASH.length + DASH.gap
  let along = 0 // metres of road laid so far, so the dash pattern runs on across joints
  let dashes = 0
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    if (seg.type !== 'gap' && seg.type !== 'loop') {
      for (let d = Math.ceil(along / period) * period - period; d < along + len; d += period) {
        const t0 = Math.max(0, (d - along) / len)
        const t1 = Math.min(1, (d + DASH.length - along) / len)
        if (t1 - t0 < 0.05 / len) continue
        out.add(ps[i], seg, -DASH.width / 2, DASH.width / 2, ROAD_TOP + DECAL_LIFT, t0, t1)
        dashes++
      }
    }
    along += len
  })
  const dashIndices = out.indexCount
  let strips = 0
  for (const zone of track.zones ?? []) {
    if (!(SURFACE_KINDS as readonly string[]).includes(zone.kind as SurfaceKind)) continue
    const seg = track.segments[zone.segment]
    const half = TRIM.length / 2 / segmentLength(seg)
    for (const t of [zone.from, zone.to]) {
      out.add(ps[zone.segment], seg, -TRIM_HALF_WIDTH, TRIM_HALF_WIDTH, ROAD_TOP + DECAL_LIFT, Math.max(0, t - half), Math.min(1, t + half))
      strips++
    }
  }
  return { ...out.build(), dashes, strips, dashIndices }
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
  flat(mesh, 'curb')
  mesh.receiveShadow = true
  mesh.renderOrder = 1 // after the road (decals write no depth); surface patches and pads draw over it
  return mesh
}

/**
 * The edge lines lit as neon (glow.ts 'edge-line'): self-lit over the painted lines, one more decal
 * step up, so the bloom pass haloes them by day and strongly at night. Same shape as the painted lines.
 */
export const createEdgeLines = (track: Track): THREE.Mesh => {
  const { positions, indices } = edgeLines(track)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, glowMaterial('edge-line', { ...DECAL, polygonOffsetUnits: -2, roughness: 0.55 }))
  mesh.name = 'edge-lines'
  flat(mesh, 'decal')
  mesh.renderOrder = 2
  return mesh
}

/**
 * Centre dashes and trim strips (roadMarkings) as one white decal mesh in two groups. The dashes are
 * opaque, so they draw before the (transparent) surface patches and a patch of dirt or ice covers
 * them; the trims are transparent at full opacity and draw after the patches, over their fade.
 */
export const createMarkings = (track: Track): THREE.Mesh => {
  const { positions, indices, dashIndices } = roadMarkings(track)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.addGroup(0, dashIndices, 0)
  geo.addGroup(dashIndices, indices.length - dashIndices, 1)
  geo.computeVertexNormals()
  const paint = { ...DECAL, color: CURB_WHITE, roughness: 0.55 }
  const mesh = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial(paint), new THREE.MeshStandardMaterial({ ...paint, transparent: true })])
  mesh.name = 'markings'
  flat(mesh, 'road')
  mesh.receiveShadow = true
  mesh.renderOrder = 1.5 // trims after the surface patches (1), under the turbo pads (2)
  return mesh
}
