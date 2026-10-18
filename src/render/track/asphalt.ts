// Procedural asphalt: grain, wear and sheen layered over the road material's own colour and
// roughness, so the procedural road (mesh.ts) and the Kenney pieces' road (kenney.ts) read as one
// surface. Everything here multiplies the material uniforms (color, roughness) instead of replacing
// them, so whatever retints or wets the road — the theme, rain (every material named `road`) —
// still lands on top. No image files: the texture is generated here (AGENTS.md § Assets).
import * as THREE from 'three/webgpu'
import { attribute, float, materialColor, materialRoughness, mix, positionWorld, texture } from 'three/tsl'
import { anisotropy } from '../anisotropy'

/** Texture side in texels. */
export const ASPHALT_TEXELS = 256
/** Grain repeats every this many metres in world x/z; the wear layer samples the same texture at WEAR_METRES. */
export const GRAIN_METRES = 3
export const WEAR_METRES = 37
/** Lateral offset (metres from the centreline, CELL-wide road) of the two worn wheel tracks. */
export const WHEEL_TRACK = 1.7
const WHEEL_TRACK_SIGMA = 0.55

// Integer hash → 0..1, deterministic across runs (no Math.random).
const hash = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// Value noise on a `period`-cell lattice that wraps, so the texture tiles without a seam.
const tiledNoise = (x: number, y: number, period: number, seed: number): number => {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const sx = (x - x0) ** 2 * (3 - 2 * (x - x0))
  const sy = (y - y0) ** 2 * (3 - 2 * (y - y0))
  const at = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed)
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
  return top + (bottom - top) * sy
}

/**
 * RGBA texels: R is grain (aggregate speckle over fine mottling), G a soft wear field (patches
 * polished by traffic), B sparse light stones. Every layer's lattice divides the texture side, so it tiles.
 */
export const asphaltTexels = (size = ASPHALT_TEXELS): Uint8Array => {
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const speckle = hash(x, y, 3)
      const mottle = tiledNoise((x * 32) / size, (y * 32) / size, 32, 4)
      const grain = 0.45 * speckle + 0.55 * mottle
      const wear = 0.6 * tiledNoise((x * 4) / size, (y * 4) / size, 4, 7) + 0.4 * tiledNoise((x * 8) / size, (y * 8) / size, 8, 8)
      const stone = hash(x, y, 13) > 0.985 ? 255 : 0
      out.set([Math.round(255 * grain), Math.round(255 * wear), stone, 255], (y * size + x) * 4)
    }
  }
  return out
}

/** Wheel-track wear at lateral offset `u` (metres, CELL-wide road): 1 in a worn track, ~0 at the centre and the edges. */
export const wheelTrackWear = (u: number): number => Math.exp(-(((Math.abs(u) - WHEEL_TRACK) / WHEEL_TRACK_SIGMA) ** 2))

/** How far a fully worn patch lowers roughness: polished asphalt is glossier, so the sheen sits in the wheel tracks. */
export const WEAR_POLISH = 0.4
/** Roughness of asphalt whose material roughness is `base` (dry, or wet in rain) at wear 0..1 — the node graph's formula. */
export const asphaltRoughness = (base: number, wear: number): number => base * (1 - WEAR_POLISH * Math.min(1, Math.max(0, wear)))

/** Grain swings the colour by ±GRAIN; wear darkens it a little, a stone lifts it. */
export const GRAIN = 0.22
export const asphaltShade = (grain: number, wear: number, stone: number): number => (1 - GRAIN + 2 * GRAIN * grain) * (1 - 0.18 * wear) * (1 + 0.6 * stone)

let shared: THREE.DataTexture | null = null
const asphaltTexture = (): THREE.DataTexture => {
  if (shared) return shared
  const tex = new THREE.DataTexture(asphaltTexels(), ASPHALT_TEXELS, ASPHALT_TEXELS)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = anisotropy()
  tex.needsUpdate = true
  return (shared = tex)
}

/** Attributes the procedural road mesh carries (mesh.ts): 1 on asphalt columns and 0 on curb and grass; the column's lateral metres. */
export const ASPHALT_MASK = 'asphalt'
export const ASPHALT_LANE = 'lane'

/**
 * Layer grain, wear and sheen over a road material. `lanes`: the mesh carries ASPHALT_MASK and
 * ASPHALT_LANE (the procedural road, whose one mesh also holds curb and grass columns); without
 * them (a Kenney piece's `road` material) the whole material is asphalt and only the world-space
 * wear patches apply. The colour and roughness are products of the material's own uniforms.
 */
export const applyAsphalt = (material: THREE.MeshStandardMaterial, lanes = false): void => {
  const tex = asphaltTexture()
  const fine = texture(tex, positionWorld.xz.div(GRAIN_METRES))
  const coarse = texture(tex, positionWorld.xz.div(WEAR_METRES))
  const mask = lanes ? attribute<'float'>(ASPHALT_MASK, 'float') : float(1)
  // Node twin of wheelTrackWear.
  const track = lanes ? attribute<'float'>(ASPHALT_LANE, 'float').abs().sub(WHEEL_TRACK).div(WHEEL_TRACK_SIGMA).pow(2).negate().exp() : float(0)
  const wear = coarse.g.mul(0.55).add(track.mul(0.6)).min(1).mul(mask)
  const shade = float(1 - GRAIN)
    .add(fine.r.mul(2 * GRAIN))
    .mul(float(1).sub(wear.mul(0.18)))
    .mul(float(1).add(fine.b.mul(0.6)))
  const m = material as THREE.MeshStandardMaterial & { colorNode: unknown; roughnessNode: unknown }
  m.colorNode = materialColor.mul(mix(float(1), shade, mask)) // vec3: the material's opacity and vertex colours still apply
  m.roughnessNode = materialRoughness.mul(float(1).sub(wear.mul(WEAR_POLISH))).mul(mix(float(1), fine.r.mul(0.2).add(0.9), mask))
  material.needsUpdate = true
}
