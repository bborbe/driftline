// Per-track look: an optional `theme` block in a track file that overrides the shared stadium look
// (src/render/look.ts, src/render/scene.ts) one lever at a time. Render-only: physics never reads
// it and it is not part of layoutId, so retheming a track keeps its records. Pure TypeScript, so
// validation runs where the rest of the format does. Defaults live in src/render/theme.ts.

/** Sky backdrop and image-based light: one Poly Haven HDRI each (assets/sky/, src/render/theme.ts). */
export type Sky = 'day' | 'sunset' | 'dusk' | 'night' | 'overcast'

export const SKIES: readonly Sky[] = ['day', 'sunset', 'dusk', 'night', 'overcast']

/** Every field is optional; an absent one keeps the default look. Colours are sRGB `#rrggbb`. */
export interface Theme {
  /** Background and environment light (default `day`). */
  sky?: Sky
  /** Image-based light strength from the sky (default 0.45). */
  skyLight?: number
  /** Tone-mapping exposure: below 1 darkens the whole frame (default 1). */
  exposure?: number
  /** Distance fog colour; match it to the sky's horizon (default `#b9d4e8`). */
  fog?: string
  /** Fog start and full-fog distance in metres (default 250 and 1200). */
  fogNear?: number
  fogFar?: number
  /** Sun colour and intensity (default `#fff4e0`, 2.2). */
  sun?: string
  sunIntensity?: number
  /** Grass tint (default `#7fc25a`). */
  ground?: string
  /** Curb stripe accent, alternating with white (default red). */
  curb?: string
  /** Turn-sign chevrons and border on the black board (default yellow). Turbo signs keep their colours. */
  sign?: string
  /** Arena screen background (default navy-blue gradient). */
  screen?: string
  /** Grandstand seat and trim colour, also worn by part of the crowd (default: the `curb` accent, else the stands' own red). */
  stand?: string
  /** Kenney Nature Kit model names (assets/nature-kit/<name>.glb) the scenery picks from. */
  scenery?: string[]
}

const COLOUR_KEYS = ['fog', 'sun', 'ground', 'curb', 'sign', 'screen', 'stand'] as const
const NUMBER_KEYS = ['skyLight', 'exposure', 'fogNear', 'fogFar', 'sunIntensity'] as const
const KEYS: readonly string[] = ['sky', 'scenery', ...COLOUR_KEYS, ...NUMBER_KEYS]

export const isColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Errors in a `theme` block, prefixed `theme`; empty when valid. Unknown keys are errors, so a typo never silently does nothing. */
export function validateTheme(data: unknown): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ['theme must be an object']
  const t = data as Record<string, unknown>
  const errs: string[] = []
  for (const k of Object.keys(t)) if (!KEYS.includes(k)) errs.push(`theme.${k}: unknown key`)
  if (t.sky !== undefined && !SKIES.includes(t.sky as Sky)) errs.push(`theme.sky must be one of ${SKIES.join('|')}`)
  for (const k of COLOUR_KEYS) if (t[k] !== undefined && !isColour(t[k])) errs.push(`theme.${k} must be a #rrggbb colour`)
  for (const k of NUMBER_KEYS) if (t[k] !== undefined && !(Number.isFinite(t[k]) && (t[k] as number) > 0)) errs.push(`theme.${k} must be > 0`)
  const near = Number.isFinite(t.fogNear) ? (t.fogNear as number) : 250
  const far = Number.isFinite(t.fogFar) ? (t.fogFar as number) : 1200
  if (near >= far) errs.push('theme.fogNear must be below theme.fogFar')
  if (t.scenery !== undefined) {
    const ok = Array.isArray(t.scenery) && t.scenery.length > 0 && t.scenery.every((m) => typeof m === 'string' && /^[A-Za-z0-9_]+$/.test(m))
    if (!ok) errs.push('theme.scenery must be a non-empty list of Nature Kit model names')
  }
  return errs
}
