// Turbo pads and surface patches (dirt, ice, grass) drawn as decals on the asphalt. Placement uses
// the same segment fractions the physics reads materials from: pads by zoneCorners() on planar
// segments, surfaces along the road mesh's own rows (rowCount + lateralPoint) on every road piece.
// Every footprint stays inside the asphalt between the curbs (the physics patch is wider, full TRACK_WIDTH).
// Pads are hard-edged objects (a quad plus chevrons). Surfaces are a fine grid with per-vertex
// colour noise and an alpha that frays out at ragged edges, so they read as dirt or ice on the road
// instead of a pasted rectangle; a tiled grain texture adds close-up detail.
// Decals sit a hair above the road top and win the depth test by polygonOffset, not by a lift:
// a larger lift shows as seams and a coplanar decal flickers (z-fighting).
import * as THREE from 'three/webgpu'
import { isEffect, poses, sampleSegment, segmentLength, SURFACE_KINDS, turnSign, zoneCorners, type Pose, type SurfaceKind, type Track, type Zone, type ZoneKind } from '../../track/schema'
import { EFFECT_LOOK, effectIcon } from './effect-pads'
import { flat } from '../tags'
import { padEmissive, tagGlow } from '../glow'
import { lateralPoint, PROFILE, roadScale, rowCount } from './geometry'

const roadColumns = PROFILE.filter(([, , band]) => band === 'road')
/** Lateral offsets of the road mesh's asphalt columns, left to right (PROFILE order). */
const ROAD_COLUMNS = roadColumns.map(([u]) => u)
/** Half-width of the asphalt between the curbs (Kenney straight: 6.9 m of road). */
export const ROAD_HALF_WIDTH = Math.max(...roadColumns.map(([u]) => Math.abs(u)))
/** Height of the asphalt above the segment's pose (the Kenney road top). */
export const ROAD_TOP = roadColumns[0][1]
/** Turbo pads: a little inside the asphalt, so a strip of road shows before the curb (CELL-wide road; padWidth for any). */
export const ZONE_WIDTH = 2 * ROAD_HALF_WIDTH - 0.5
/** A pad's width on its own segment: the asphalt there, at its narrower end, less ZONE_WIDTH's 0.5 m. */
export const padWidth = (track: Track, zone: Zone): number => {
  const seg = track.segments[zone.segment]
  return 2 * ROAD_HALF_WIDTH * Math.min(roadScale(seg, zone.from), roadScale(seg, zone.to)) - 0.5
}
/** Turbo pads run the full asphalt width (less a hair, so the curb never z-fights them), like a painted boost lane. */
export const turboPadWidth = (track: Track, zone: Zone): number => padWidth(track, zone) + 0.4
/** Surfaces: the whole asphalt of a CELL-wide road, stretched by roadScale; the ragged fade keeps them off the curbs. */
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
  'turbo': { color: 0xffae00, emissive: 0.5 },
  'turbo-red': { color: 0xff2a2a, emissive: 0.6 },
}

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
export const zoneQuad = (track: Track, zone: Zone, width = padWidth(track, zone)): Float32Array => {
  const [l0, r0, l1, r1] = zoneCorners(track, zone, width)
  return new Float32Array([...lift(l0, ZONE_LIFT), ...lift(r0, ZONE_LIFT), ...lift(l1, ZONE_LIFT), ...lift(r0, ZONE_LIFT), ...lift(r1, ZONE_LIFT), ...lift(l1, ZONE_LIFT)])
}

/** Turbo chevrons: one per this many metres of pad (at least MIN_CHEVRONS), spanning CHEVRON_SPAN of its width. */
export const CHEVRON_PITCH = 2.5
export const MIN_CHEVRONS = 2
export const CHEVRON_SPAN = 0.86
/** Arm thickness of a chevron along the road, as a fraction of its slot. */
const CHEVRON_ARM = 0.45

/**
 * Bold V chevrons on a turbo pad pointing along its arrow (padForward: the direction physics boosts),
 * as triangle positions slightly above its quad. Each chevron is two arms, 4 triangles (12 vertices):
 * vertex 0 is the left outer back corner, 2 the outer tip, 7 the right outer back corner. A reversed
 * pad swaps the ends so the tips point back.
 */
export const turboChevrons = (track: Track, zone: Zone, width = turboPadWidth(track, zone)): Float32Array => {
  const [c0, c1, c2, c3] = zoneCorners(track, zone, width * CHEVRON_SPAN)
  const [l0, r0, l1, r1] = zone.reverse ? [c3, c2, c1, c0] : [c0, c1, c2, c3]
  const length = Math.hypot((l1.x + r1.x - l0.x - r0.x) / 2, (l1.z + r1.z - l0.z - r0.z) / 2)
  const count = Math.max(MIN_CHEVRONS, Math.round(length / CHEVRON_PITCH))
  const out: number[] = []
  const dy = ZONE_LIFT + 0.002
  // A point at u across (0 left .. 1 right) and v along (0 entry .. 1 exit) the chevron band.
  const at = (u: number, v: number): Pose => lerp(lerp(l0, r0, u), lerp(l1, r1, u), v)
  for (let i = 0; i < count; i++) {
    const back = (i + 0.1) / count
    const tip = (i + 0.9) / count
    const arm = CHEVRON_ARM * (tip - back)
    // Each arm lies between a leading edge (outer back corner → tip) and the same edge `arm` behind it.
    const lo = at(0, back + arm)
    const li = at(0, back)
    const ro = at(1, back + arm)
    const ri = at(1, back)
    const to = at(0.5, tip)
    const ti = at(0.5, tip - arm)
    for (const p of [lo, li, to, li, ti, to, ri, ro, to, ri, to, ti]) out.push(...lift(p, dy))
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
 * A run never joins across the start line: lap distance restarts there, so the patch fades out
 * and in again instead of showing a colour seam.
 */
export const surfaceJoins = (track: Track, zone: Zone): { start: boolean; end: boolean } => {
  const zones = track.zones ?? []
  const n = track.segments.length
  const has = (segment: number, at: 'from' | 'to') =>
    zones.some((z) => z.kind === zone.kind && z.segment === segment && (at === 'from' ? z.from === 0 : z.to === 1))
  return {
    start: zone.from === 0 && zone.segment > 0 && has(zone.segment - 1, 'to'),
    end: zone.to === 1 && zone.segment < n - 1 && has(zone.segment + 1, 'from'),
  }
}

/**
 * A surface zone as a grid over the road: full road width plus a little, overrunning the zone's
 * ends by SURFACE_OVERRUN. Rows follow the segment's centreline and bank roll, interpolated
 * between the road mesh's own rows (rowCount, sampleSegment, lateralPoint): the drawn road is flat
 * between its rows, so a patch sampled on the true surface would dip under it on a banked turn.
 * A patch lies on curves, hairpins and banked turns as well as straights. Alpha is 1 inside and frays to 0 over EDGE_FADE at every edge
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
  const roadRows = rowCount(seg)
  const road = Array.from({ length: roadRows }, (_, r) => sampleSegment(entry, seg, r / (roadRows - 1)))
  // Point `lat` metres left of the centreline at fraction `f` of the segment, on the drawn road:
  // the road mesh's own triangle (buildSegment splits quad A B / C D along B–C), so the patch keeps
  // its lift over the road everywhere, also where a banked quad is twisted.
  const roadPoint = (f: number, lat: number): number[] => {
    const at = Math.min(roadRows - 1 - 1e-9, Math.max(0, f * (roadRows - 1)))
    const r0 = Math.floor(at)
    const k = at - r0
    const l = Math.min(ROAD_COLUMNS[0], Math.max(ROAD_COLUMNS[ROAD_COLUMNS.length - 1], lat))
    const c = Math.max(0, ROAD_COLUMNS.findIndex((u, i) => i < ROAD_COLUMNS.length - 1 && l <= u && l >= ROAD_COLUMNS[i + 1]))
    const w = (ROAD_COLUMNS[c] - l) / (ROAD_COLUMNS[c] - ROAD_COLUMNS[c + 1])
    // `lat` is on a CELL-wide road; each road row is stretched by its own roadScale, as buildSegment draws it.
    const [k0, k1] = [roadScale(seg, r0 / (roadRows - 1)), roadScale(seg, (r0 + 1) / (roadRows - 1))]
    const A = lateralPoint(road[r0], ROAD_COLUMNS[c] * k0, s)
    const B = lateralPoint(road[r0], ROAD_COLUMNS[c + 1] * k0, s)
    const C = lateralPoint(road[r0 + 1], ROAD_COLUMNS[c] * k1, s)
    const D = lateralPoint(road[r0 + 1], ROAD_COLUMNS[c + 1] * k1, s)
    return k + w <= 1 ? A.map((a, i) => a + w * (B[i] - a) + k * (C[i] - a)) : D.map((d, i) => d + (1 - w) * (C[i] - d) + (1 - k) * (B[i] - d))
  }
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
    const f = from + (to - from) * t
    const v = t * along // metres along this patch
    const lapV = lapBefore + from * length + v // metres along the lap
    const k = roadScale(seg, f) // the road's stretch here: `cu` is on a CELL-wide road, `u` in metres
    for (let c = 0; c < cols; c++) {
      const cu = (c / (cols - 1)) * SURFACE_WIDTH
      const u = cu * k // metres across, from the left edge
      const [x, y, z] = roadPoint(f, SURFACE_WIDTH / 2 - cu)
      const i = r * cols + c
      positions.set([x, y + ZONE_LIFT, z], i * 3)
      uvs.set([u, lapV], i * 2)
      // Distance to the nearest edge. The fade starts a noisy 0..EDGE_FADE/2 in from the edge and
      // takes another EDGE_FADE/2 to reach opaque, so the border frays but the outline is always clear.
      const edge = Math.min(u, SURFACE_WIDTH * k - u, open.start ? Infinity : v, open.end ? Infinity : along - v)
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
        // Turbo pads glow through the bloom pass (glow.ts); effect pads stay below its day threshold.
        const pad = new THREE.MeshStandardMaterial({ ...DECAL, color: look.color, emissive: look.color, emissiveIntensity: padEmissive(look.emissive), roughness: 0.4 })
        materials.set(kind, tagGlow(pad, 'turbo-pad'))
      }
      group.add(flat(padMesh(zoneQuad(track, zone, turboPadWidth(track, zone)), materials.get(kind)!, 2), 'effect-pad'))
      group.add(flat(padMesh(turboChevrons(track, zone), chevron, 3), 'decal'))
    } else if (isEffect(kind)) {
      if (!materials.has(kind)) {
        const look = EFFECT_LOOK[kind]
        materials.set(kind, new THREE.MeshStandardMaterial({ ...DECAL, color: look.color, emissive: look.color, emissiveIntensity: look.emissive, roughness: 0.4 }))
      }
      group.add(flat(padMesh(zoneQuad(track, zone), materials.get(kind)!, 2), 'effect-pad'))
      group.add(flat(padMesh(effectIcon(track, { ...zone, kind }, padWidth(track, zone), ZONE_LIFT + 0.002), chevron, 3), 'decal'))
    } else {
      if (!materials.has(kind)) materials.set(kind, surfaceMaterial(kind))
      group.add(flat(patchMesh(surfacePatch(track, { ...zone, kind }), materials.get(kind)!), 'decal'))
    }
  }
  return group
}
