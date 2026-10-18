// Graphics quality: the Low / Medium / High presets, each a fixed set of render knobs, plus Auto (a short
// frame-time probe picks one of the three) and Custom (the player changed a knob by hand). Every knob is
// render-only: nothing here reaches physics, the ghost or the lap timer. Pure and tested.

/** Storage this module reads and writes (localStorage in the game, a Map-backed stub in tests). */
type Store = Pick<Storage, 'getItem' | 'setItem'>

export const PRESETS = ['low', 'medium', 'high'] as const
export type Preset = (typeof PRESETS)[number]
export const QUALITY = [...PRESETS, 'auto', 'custom'] as const
export type Quality = (typeof QUALITY)[number]

export const SHADOW_SIZES = [0, 1024, 2048] as const
export type ShadowSize = (typeof SHADOW_SIZES)[number]
export const PIXEL_RATIOS = [1, 1.5, 2] as const
export const PARTICLE_SCALES = [0.25, 0.5, 1] as const

/** The render knobs a preset sets. Reflections and FXAA are the Graphics settings of the same name. */
export interface Knobs {
  /** Cap on the renderer's pixel ratio (min with devicePixelRatio). */
  pixelRatio: number
  /** Sun shadow-map size; 0 is no shadows. */
  shadows: ShadowSize
  /** The post pipeline (render/post.ts: bloom, grade, AO, FXAA); off draws the plain scene. */
  post: boolean
  /** Neon Night's road reflection. */
  reflections: boolean
  /** FXAA, the post pipeline's last pass. */
  aa: boolean
  /** Particle budget multiplier: smoke, dust, rain and snow. */
  particles: number
}

/** High is today's look (FXAA stays opt-in: it costs ~10% fps and the scene pass already has MSAA). */
const TABLE: Record<Preset, Knobs> = {
  low: { pixelRatio: 1, shadows: 0, post: false, reflections: false, aa: false, particles: 0.25 },
  medium: { pixelRatio: 1.5, shadows: 1024, post: true, reflections: true, aa: false, particles: 0.5 },
  high: { pixelRatio: 2, shadows: 2048, post: true, reflections: true, aa: false, particles: 1 },
}

export const qualityKnobs = (p: Preset): Knobs => ({ ...TABLE[p] })

export const sameKnobs = (a: Knobs, b: Knobs): boolean =>
  a.pixelRatio === b.pixelRatio && a.shadows === b.shadows && a.post === b.post && a.reflections === b.reflections && a.aa === b.aa && a.particles === b.particles

const oneOf = <T>(v: unknown, ok: readonly T[], fallback: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : fallback)

/** Stored knobs with every unknown or missing value replaced by High's. */
export function clampKnobs(raw: unknown): Knobs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = TABLE.high
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f)
  return {
    pixelRatio: oneOf(r.pixelRatio, PIXEL_RATIOS, d.pixelRatio),
    shadows: oneOf(r.shadows, SHADOW_SIZES, d.shadows),
    post: bool(r.post, d.post),
    reflections: bool(r.reflections, d.reflections),
    aa: bool(r.aa, d.aa),
    particles: oneOf(r.particles, PARTICLE_SCALES, d.particles),
  }
}

/** A stored quality, else High. */
export const clampQuality = (v: unknown): Quality => oneOf(v, QUALITY, 'high')

/** Auto's thresholds on the probe's average fps. */
export const AUTO_HIGH_FPS = 55
export const AUTO_MEDIUM_FPS = 40
export const pickQuality = (avgFps: number): Preset => (avgFps >= AUTO_HIGH_FPS ? 'high' : avgFps >= AUTO_MEDIUM_FPS ? 'medium' : 'low')

/** The probe skips this much first (shader compilation stalls the first frames: loading, not driving), then measures PROBE_S. */
export const PROBE_WARMUP_S = 3
export const PROBE_S = 3

/** Feed it every frame's dt while Auto draws High; it returns the picked preset once, after warm-up + PROBE_S, then null. */
export class QualityProbe {
  private warmup = PROBE_WARMUP_S
  private time = 0
  private frames = 0
  private done = false

  push(dtS: number): Preset | null {
    if (this.done || dtS <= 0) return null
    if (this.warmup > 0) {
      this.warmup -= dtS
      return null
    }
    this.time += dtS
    this.frames++
    if (this.time < PROBE_S) return null
    this.done = true
    return pickQuality(this.frames / this.time)
  }
}

const AUTO_KEY = 'driftline-quality-auto'

/** Auto's result is kept per device: user agent plus pixel ratio, so another screen or browser probes again. */
export const deviceKey = (userAgent: string, dpr: number): string => `${userAgent}|${dpr}`

export function loadAutoQuality(storage: Store, device: string): Preset | null {
  try {
    const raw = JSON.parse(storage.getItem(AUTO_KEY) ?? 'null')
    return raw && raw.device === device ? oneOf<Preset | null>(raw.level, PRESETS, null) : null
  } catch {
    return null
  }
}

/** Store Auto's pick; null forgets it, so the next race probes again (Settings → Re-probe). */
export function saveAutoQuality(storage: Store, device: string, level: Preset | null): void {
  storage.setItem(AUTO_KEY, JSON.stringify(level ? { device, level } : null))
}

/** The knobs a quality setting draws with: a preset's own, Auto's probed (High until it has run), or the stored Custom ones. */
export function effectiveKnobs(quality: Quality, custom: Knobs, auto: Preset | null): Knobs {
  if (quality === 'custom') return { ...custom }
  if (quality === 'auto') return qualityKnobs(auto ?? 'high')
  return qualityKnobs(quality)
}
