// Turbo pads and surface patches (dirt, ice, grass) drawn as decals on the asphalt. Placement comes
// from zoneCorners() — the same fractions the physics reads materials from — and every footprint
// stays inside the asphalt between the curbs (the physics patch is wider, full TRACK_WIDTH).
// Pads are hard-edged objects (a quad plus chevrons). Surfaces are a fine grid with per-vertex
// colour noise and an alpha that frays out at ragged edges, so they read as dirt or ice on the road
// instead of a pasted rectangle; a tiled grain texture adds close-up detail.
// Decals sit a hair above the road top and win the depth test by polygonOffset, not by a lift:
// a larger lift shows as seams and a coplanar decal flickers (z-fighting).
import * as THREE from 'three/webgpu'
import { poses, sampleSegment, segmentLength, SURFACE_KINDS, turnSign, zoneCorners, type Pose, type Track, type Zone, type ZoneKind } from '../../track/schema'
import { lateralPoint, PROFILE } from './geometry'

const roadColumns = PROFILE.filter(([, , band]) => band === 'road')
/** Half-width of the asphalt between the curbs (Kenney straight: 6.9 m of road). */
export const ROAD_HALF_WIDTH = Math.max(...roadColumns.map(([u]) => Math.abs(u)))
/** Height of the asphalt above the segment's pose (the Kenney road top). */
export const ROAD_TOP = roadColumns[0][1]
/** Turbo pads: a little inside the asphalt, so a strip of road shows before the curb. */
export const ZONE_WIDTH = 2 * ROAD_HALF_WIDTH - 0.5
/** Surfaces: the whole asphalt; the ragged fade keeps them off the curbs. */
export const SURFACE_WIDTH = 2 * ROAD_HALF_WIDTH
/** Decal height over the segment's pose: the road top plus 3 mm (polygonOffset does the rest). */
export const ZONE_LIFT = ROAD_TOP + 0.003
/** Surface patches overrun their physics extent by this much at each end, inside the fade. */
export const SURFACE_OVERRUN = 1.5
/** Width of the ragged fade at a surface patch's edges, in metres. */
export const EDGE_FADE = 1.2
/** Grid spacing of a surface patch, in metres. */
export const GRID = 0.3

const PAD_LOOK: Record<'turbo' | 'turbo-red', { color: number; emissive: number }> = {
  'turbo': { color: 0xffd60a, emissive: 0.5 },
  'turbo-red': { color: 0xff2a2a, emissive: 0.6 },
}

type SurfaceKind = Exclude<ZoneKind, 'turbo' | 'turbo-red'>

// Base colour (sRGB) and the two noise layers mixed into it. `dark`/`light` are the extremes the
// mottling swings between; `streak` stretches the noise along the road (ice reads as polished, dirt as tracked).
const SURFACE_LOOK: Record<SurfaceKind, { dark: [number, number, number]; light: [number, number, number]; streak: number }> = {
  dirt: { dark: [0.29, 0.19, 0.11], light: [0.52, 0.38, 0.24], streak: 2.5 },
  grass: { dark: [0.18, 0.33, 0.12], light: [0.36, 0.55, 0.24], streak: 1 },
  ice: { dark: [0.62, 0.78, 0.9], light: [0.93, 0.97, 1.0], streak: 6 },
}

const lift = (p: Pose, dy: number): number[] => [p.x, p.y + dy, p.z]

const lerp = (a: Pose, b: Pose, t: number): Pose => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
  heading: a.heading,
})

/** Flat quad of a zone as triangle positions (two triangles). */
export const zoneQuad = (track: Track, zone: Zone, width = ZONE_WIDTH): Float32Array => {
  const [l0, r0, l1, r1] = zoneCorners(track, zone, width)
  return new Float32Array([...lift(l0, ZONE_LIFT), ...lift(r0, ZONE_LIFT), ...lift(l1, ZONE_LIFT), ...lift(r0, ZONE_LIFT), ...lift(r1, ZONE_LIFT), ...lift(l1, ZONE_LIFT)])
}

/**
 * Chevrons on a turbo pad pointing along its arrow (padForward: the direction physics boosts), as
 * triangle positions slightly above its quad. A reversed pad swaps the ends so the tips point back.
 */
export const turboChevrons = (track: Track, zone: Zone, count = 3, width = ZONE_WIDTH): Float32Array => {
  const [c0, c1, c2, c3] = zoneCorners(track, zone, width * 0.7)
  const [l0, r0, l1, r1] = zone.reverse ? [c3, c2, c1, c0] : [c0, c1, c2, c3]
  const out: number[] = []
  const dy = ZONE_LIFT + 0.002
  for (let i = 0; i < count; i++) {
    const a = (i + 0.15) / count
    const b = (i + 0.85) / count
    const left = lerp(l0, l1, a)
    const right = lerp(r0, r1, a)
    const tip = lerp(lerp(l0, r0, 0.5), lerp(l1, r1, 0.5), b)
    out.push(...lift(left, dy), ...lift(right, dy), ...lift(tip, dy))
  }
  return new Float32Array(out)
}

// Deterministic value noise in 0..1: hashed lattice values, smoothly interpolated.
const hash = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const smooth = (t: number) => t * t * (3 - 2 * t)
export const valueNoise = (x: number, y: number, seed = 0): number => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  const a = hash(xi, yi, seed) + (hash(xi + 1, yi, seed) - hash(xi, yi, seed)) * u
  const b = hash(xi, yi + 1, seed) + (hash(xi + 1, yi + 1, seed) - hash(xi, yi + 1, seed)) * u
  return a + (b - a) * v
}
/** Two octaves of value noise, 0..1. */
const fbm = (x: number, y: number, seed: number): number => 0.65 * valueNoise(x, y, seed) + 0.35 * valueNoise(2.1 * x, 2.1 * y, seed + 7)

export type SurfacePatch = {
  positions: Float32Array // xyz per vertex
  colors: Float32Array // rgba per vertex, rgb in linear space (three.js reads vertex colours as linear)
  uvs: Float32Array // metres across / along, for the tiled grain texture
  indices: Uint32Array
}

/**
 * Whether a surface zone runs on into the same surface on the previous / next segment: a zone
 * that starts at 0 (ends at 1) where the neighbouring segment's zone of the same kind ends at 1
 * (starts at 0). Kit pieces carry one full-length zone per segment, so a run of dirt pieces is
 * many zones; an open end skips the fade there, so the run draws as one patch with no seams.
 */
export const surfaceJoins = (track: Track, zone: Zone): { start: boolean; end: boolean } => {
  const zones = track.zones ?? []
  const n = track.segments.length
  const has = (segment: number, at: 'from' | 'to') =>
    zones.some((z) => z.kind === zone.kind && z.segment === segment && (at === 'from' ? z.from === 0 : z.to === 1))
  return {
    start: zone.from === 0 && has((zone.segment - 1 + n) % n, 'to'),
    end: zone.to === 1 && has((zone.segment + 1) % n, 'from'),
  }
}

/**
 * A surface zone as a grid over the road: full road width plus a little, overrunning the zone's
 * ends by SURFACE_OVERRUN. Rows follow the segment's centreline and bank roll (sampleSegment +
 * lateralPoint, the road mesh's own functions), so a patch lies on curves, hairpins and banked
 * turns as well as straights. Alpha is 1 inside and frays to 0 over EDGE_FADE at every edge
 * except an open end (surfaceJoins), with the fade line jittered by noise so the border is ragged.
 * Noise and grain run on distance along the whole lap, so joined patches meet without a seam.
 */
export const surfacePatch = (track: Track, zone: Zone & { kind: SurfaceKind }, open = surfaceJoins(track, zone)): SurfacePatch => {
  const seg = track.segments[zone.segment]
  const entry = poses(track)[zone.segment]
  const length = segmentLength(seg)
  const lapBefore = track.segments.slice(0, zone.segment).reduce((d, sg) => d + segmentLength(sg), 0)
  const pad = SURFACE_OVERRUN / Math.max(length, 1e-9)
  const from = open.start ? zone.from : Math.max(0, zone.from - pad)
  const to = open.end ? zone.to : Math.min(1, zone.to + pad)
  const s = turnSign(seg)
  const along = (to - from) * length
  const cols = Math.max(2, Math.round(SURFACE_WIDTH / GRID) + 1)
  const rows = Math.max(2, Math.round(along / GRID) + 1)
  const look = SURFACE_LOOK[zone.kind]
  const seed = SURFACE_KINDS.indexOf(zone.kind) * 31
  const positions = new Float32Array(rows * cols * 3)
  const colors = new Float32Array(rows * cols * 4)
  const uvs = new Float32Array(rows * cols * 2)
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1)
    const sample = sampleSegment(entry, seg, from + (to - from) * t)
    const v = t * along // metres along this patch
    const lapV = lapBefore + from * length + v // metres along the lap
    for (let c = 0; c < cols; c++) {
      const u = (c / (cols - 1)) * SURFACE_WIDTH // metres across, from the left edge
      const [x, y, z] = lateralPoint(sample, SURFACE_WIDTH / 2 - u, s)
      const i = r * cols + c
      positions.set([x, y + ZONE_LIFT, z], i * 3)
      uvs.set([u, lapV], i * 2)
      // Distance to the nearest edge. The fade starts a noisy 0..EDGE_FADE/2 in from the edge and
      // takes another EDGE_FADE/2 to reach opaque, so the border frays but the outline is always clear.
      const edge = Math.min(u, SURFACE_WIDTH - u, open.start ? Infinity : v, open.end ? Infinity : along - v)
      const start = fbm(u * 0.9, lapV * 0.9, seed + 3) * (EDGE_FADE / 2)
      const alpha = Math.min(1, Math.max(0, (edge - start) / (EDGE_FADE / 2)))
      const n = fbm(u * 0.6, lapV * (0.6 / look.streak), seed)
      for (let k = 0; k < 3; k++) colors[i * 4 + k] = (look.dark[k] + (look.light[k] - look.dark[k]) * n) ** 2.2
      colors[i * 4 + 3] = smooth(alpha)
    }
  }
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6)
  let o = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      indices.set([a, a + cols, a + 1, a + 1, a + cols, a + cols + 1], o)
      o += 6
    }
  }
  return { positions, colors, uvs, indices }
}

/** Grain texture (luminance, 0..255) multiplied over the patch colour: speckle for dirt and grass, fine scratches for ice. */
export const grainTexels = (kind: SurfaceKind, size = 128): Uint8Array => {
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let g: number
      if (kind === 'ice') {
        // Long thin scratches along the road (+y), on a bright base.
        const scratch = valueNoise(x / 3, y / 40, 11)
        g = 0.88 + 0.12 * (scratch > 0.7 ? 1 : scratch / 0.7)
      } else {
        // Pebbles and clumps: sharp-ish speckle over soft blotches (tileable across the 128 px period
        // is not needed — the patch UVs never wrap visibly at this scale).
        const speckle = hash(x, y, kind === 'dirt' ? 5 : 9)
        const blotch = valueNoise(x / 9, y / 9, kind === 'dirt' ? 6 : 10)
        g = 0.62 + 0.25 * blotch + 0.13 * speckle
      }
      const b = Math.round(255 * Math.min(1, g))
      out.set([b, b, b, 255], (y * size + x) * 4)
    }
  }
  return out
}

/** Grain texture repeats every this many metres. */
const GRAIN_METRES = 4

const grainTexture = (kind: SurfaceKind): THREE.DataTexture => {
  const size = 128
  const tex = new THREE.DataTexture(grainTexels(kind, size), size, size)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1 / GRAIN_METRES, 1 / GRAIN_METRES)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Depth settings shared by every decal: drawn over the coplanar-ish road, never occluding it. */
const DECAL = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false, side: THREE.DoubleSide } as const

const surfaceMaterial = (kind: SurfaceKind): THREE.Material => {
  const common = { ...DECAL, vertexColors: true, transparent: true, map: grainTexture(kind) }
  // Ice: glossy clear-coated sheet that mirrors the sky; dirt and grass: fully matte.
  if (kind === 'ice') return new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 })
  return new THREE.MeshStandardMaterial({ ...common, roughness: 1, metalness: 0 })
}

// Decals write no depth, so draw order decides what shows: road, then surface patches (1),
// then pads (2), then their chevrons (3).
const padMesh = (positions: Float32Array, material: THREE.Material, order: number): THREE.Mesh => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, material)
  m.receiveShadow = true
  m.renderOrder = order
  return m
}

const patchMesh = (patch: SurfacePatch, material: THREE.Material): THREE.Mesh => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(patch.colors, 4))
  geo.setAttribute('uv', new THREE.BufferAttribute(patch.uvs, 2))
  geo.setIndex(new THREE.BufferAttribute(patch.indices, 1))
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, material)
  m.receiveShadow = true
  m.renderOrder = 1
  return m
}

export const createZoneMeshes = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'zones'
  const materials = new Map<ZoneKind, THREE.Material>()
  // Chevrons sit 2 mm over their pad and get a stronger offset, so they always win against it.
  const chevron = new THREE.MeshStandardMaterial({ ...DECAL, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 })
  for (const zone of track.zones ?? []) {
    const kind = zone.kind
    if (kind === 'turbo' || kind === 'turbo-red') {
      if (!materials.has(kind)) {
        const look = PAD_LOOK[kind]
        materials.set(kind, new THREE.MeshStandardMaterial({ ...DECAL, color: look.color, emissive: look.color, emissiveIntensity: look.emissive, roughness: 0.4 }))
      }
      group.add(padMesh(zoneQuad(track, zone), materials.get(kind)!, 2))
      group.add(padMesh(turboChevrons(track, zone), chevron, 3))
    } else {
      if (!materials.has(kind)) materials.set(kind, surfaceMaterial(kind))
      group.add(patchMesh(surfacePatch(track, { ...zone, kind }), materials.get(kind)!))
    }
  }
  return group
}
