// Glow pass: the bloom post pass and the emissive look it picks up. Bloom is on by default
// (`?bloom=0` turns it off, for A/B shots and slow GPUs); a night environment (render/environment.ts)
// selects the night preset, whose bloom is stronger and wider so lights read in the dark, and Neon Night the neon preset,
// stronger again. Every glowing material is built
// or tagged here with its class (userData.glow), so a test can prove each class is wired.
// Pure data plus material factories; nothing here reads car state.
import * as THREE from 'three/webgpu'

export type GlowPreset = 'day' | 'night' | 'neon'
export const GLOW_CLASSES = ['edge-line', 'turbo-pad', 'tail-light', 'headlight', 'rim', 'neon-tube'] as const
export type GlowClass = (typeof GLOW_CLASSES)[number]

/** BloomNode parameters: strength, radius (0..1), luminance threshold (linear HDR, before tone mapping). */
export type BloomParams = { strength: number; radius: number; threshold: number }

/**
 * Day keeps bloom to what is really emissive (threshold above sunlit paint); night lowers the
 * threshold and more than doubles the strength, so the same lights halo strongly in the dark.
 */
export const BLOOM: Record<GlowPreset, BloomParams> = {
  day: { strength: 0.35, radius: 0.35, threshold: 1.0 },
  night: { strength: 0.8, radius: 0.55, threshold: 0.6 },
  // Neon Night: the tubes, rims and skyline windows halo hard against the black sky.
  neon: { strength: 1.0, radius: 0.35, threshold: 0.6 },
}

/** The bloom preset for an environment look (render/environment.ts): neon over night over day. */
export const glowPreset = (look: { night: boolean; neon: boolean }): GlowPreset => (look.neon ? 'neon' : look.night ? 'night' : 'day')

/** Emissive intensity per glow class, set so each class's luminance (glowLuminance) clears the day threshold. */
export const EMISSIVE: Record<GlowClass, number> = {
  'edge-line': 1.4,
  'turbo-pad': 2.4,
  'tail-light': 6.0,
  'headlight': 3.0,
  'rim': 2.2,
  'neon-tube': 3.0,
}
/** Tail lights while braking. */
export const BRAKE_EMISSIVE = 12.0

/** Colours (sRGB hex) of the classes built here: cool white edge neon, red tails, warm white heads, cyan rims. */
export const GLOW_COLOR: Record<Exclude<GlowClass, 'turbo-pad'>, number> = {
  'edge-line': 0xe8f6ff,
  'tail-light': 0xff0a0a,
  'headlight': 0xfff2d6,
  'rim': 0x4cc9f0,
  'neon-tube': 0xffd21f,
}

/** Neon Night colours (sRGB hex): the rims turn pink, and the tubes run yellow on one side of the road and pink on the other. */
export const NEON_GLOW = { rim: 0xff3ec8, yellow: 0xffd21f, pink: 0xff2fb4 } as const

/** Bloom stays on unless `?bloom=0` (or `off` / `false`). */
export const bloomEnabled = (search: string): boolean => {
  const v = new URLSearchParams(search).get('bloom')
  return v === null || !['0', 'off', 'false'].includes(v)
}

/** The bloom parameters for a page's query and preset (the environment's night flag), or null when `?bloom=0` turns the pass off. */
export const bloomFor = (search: string, preset: GlowPreset = 'day'): BloomParams | null => (bloomEnabled(search) ? BLOOM[preset] : null)

/** Render passes in order for a page's query: the scene, then bloom unless it is off. */
export const glowPasses = (search: string): string[] => (bloomFor(search) ? ['scene', 'bloom'] : ['scene'])

/** Tail-light emissive intensity for the brake state. */
export const tailLightIntensity = (braking: boolean): number => (braking ? BRAKE_EMISSIVE : EMISSIVE['tail-light'])

/** Turbo pad emission: the pad look's own strength (0.5 = standard) scaled onto the turbo-pad level. */
export const padEmissive = (look: number): number => EMISSIVE['turbo-pad'] * (look / 0.5)

/** Linear luminance of an sRGB hex colour emitted at `intensity`: what the bloom threshold is compared with. */
export const glowLuminance = (hex: number, intensity: number): number => {
  const c = new THREE.Color(hex) // three converts sRGB hex to linear working space
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * intensity
}

/** Mark a material as one glow class (read by the wiring test and anything that retunes glow). */
export const tagGlow = <T extends THREE.Material>(material: T, glow: GlowClass): T => {
  material.userData.glow = glow
  return material
}

/** A self-lit material of one glow class: the colour is both albedo and emission. */
export const glowMaterial = (
  glow: Exclude<GlowClass, 'turbo-pad'>,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial => {
  const color = GLOW_COLOR[glow]
  return tagGlow(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: EMISSIVE[glow], roughness: 0.4, ...extra }), glow)
}

/** Every glow class present under `root`, from the tagged materials. */
export const glowClasses = (root: THREE.Object3D): Set<GlowClass> => {
  const out = new Set<GlowClass>()
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) if (mat.userData.glow) out.add(mat.userData.glow as GlowClass)
  })
  return out
}
