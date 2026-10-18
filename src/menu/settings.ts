// Player settings shown on the start screen and in the Esc menu, persisted in localStorage. Pure and tested.
import { FX, type Fx } from '../render/fx/flags'
import { clampLaps } from '../race/lap'
import { choiceOf, DEFAULT_CHOICE, TIME_CHOICES, WEATHER_CHOICES, type TimeChoice, type WeatherChoice } from '../track/environment'
import { clampLivery, DEFAULT_LIVERY, type Livery } from '../render/car/livery'
import { clampGhosts, DEFAULT_GHOSTS, type GhostKind } from '../ghost/tag'
import { clampFrameCap } from '../render/frame-cap'
import { clampKnobs, clampQuality, qualityKnobs, type Knobs, type Quality } from '../render/quality'
import { clampRecords, type RecordsChoice } from '../race/records'

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

export interface Settings {
  /** Master volume; the SFX (car, surface, race) and UI (menu) buses sit under it. */
  volume: number
  sfxVolume: number
  uiVolume: number
  fx: Fx[]
  /** Laps per race; `?laps=` overrides it. */
  laps: number
  /** Time of day: the track's own default, a random preset per race, or one preset (`?time=` / `?seed=` override it at load). */
  time: TimeChoice
  /** Weather, likewise (`?weather=` / `?seed=` override it at load). */
  weather: WeatherChoice
  /** Player car paint, pattern and race number; the ghost takes ghostLivery() of it. */
  livery: Livery
  /** Graphics quality (render/quality.ts): a preset, Auto (probed per device) or Custom; `?quality=` overrides it. */
  quality: Quality
  /**
   * The render knobs as last set: a preset's own when one was picked, the player's when Custom. Reflections
   * (Neon Night's road mirror) and FXAA live here; `?refl=0|1` and `?aa=0|1` override them and make the quality Custom.
   */
  knobs: Knobs
  /** Access tab: blue / orange deltas with ▲ ▼ and lettered medals instead of blue / red and colour alone. */
  colourSafe: boolean
  /** Access tab: no speed lines, boost streaks, camera effects or HUD pop animations; null follows the system's reduce-motion. */
  reducedEffects: boolean | null
  /** Race-HUD size multiplier (Settings → Graphics), one of HUD_SCALES. */
  hudScale: number
  /** Records panel (top left, T): open unless the window is narrow, open, or collapsed (src/race/records.ts). */
  records: RecordsChoice
  /** Render-rate cap in fps, one of FRAME_CAPS (0 = uncapped; render/frame-cap.ts); `?fps=` overrides it. Presets never change it. */
  frameCap: number
  /** Ghosts that race alongside (Settings → Race): personal best, gold and author pace; `?ghosts=` overrides it. */
  ghosts: GhostKind[]
}

/** HUD-scale choices, smallest first. */
export const HUD_SCALES = [0.75, 0.9, 1, 1.15, 1.3] as const
/** The stored HUD scale when it is one of HUD_SCALES, else 1. */
export const clampHudScale = (v: unknown): number => ((HUD_SCALES as readonly unknown[]).includes(v) ? (v as number) : 1)

const KEY = 'driftline-settings'
export const DEFAULT_SETTINGS: Settings = { volume: 0.7, sfxVolume: 1, uiVolume: 1, fx: [], laps: 1, ...DEFAULT_CHOICE, livery: DEFAULT_LIVERY, quality: 'high', knobs: qualityKnobs('high'), hudScale: 1, colourSafe: false, reducedEffects: null, records: 'auto', frameCap: 0, ghosts: [...DEFAULT_GHOSTS] }
/** Window event the settings panel fires after every change; detail is the saved Settings, which the running race applies at once. */
export const SETTINGS_EVENT = 'driftline:settings'

export function loadSettings(storage: KeyValueStore): Settings {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    const level = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d)
    const volume = level(raw.volume, DEFAULT_SETTINGS.volume)
    const sfxVolume = level(raw.sfxVolume, DEFAULT_SETTINGS.sfxVolume)
    const uiVolume = level(raw.uiVolume, DEFAULT_SETTINGS.uiVolume)
    const fx = Array.isArray(raw.fx) ? FX.filter((f) => raw.fx.includes(f)) : []
    // Before the Time and Weather selectors one `environment` mode covered both: `random` meant both random.
    const legacy = choiceOf(raw.environment === 'random' ? 'random' : 'fixed')
    const time = (TIME_CHOICES as readonly unknown[]).includes(raw.time) ? (raw.time as TimeChoice) : legacy.time
    const weather = (WEATHER_CHOICES as readonly unknown[]).includes(raw.weather) ? (raw.weather as WeatherChoice) : legacy.weather
    const { quality, knobs } = qualityOf(raw)
    const colourSafe = raw.colourSafe === true
    const reducedEffects = typeof raw.reducedEffects === 'boolean' ? raw.reducedEffects : null
    return { volume, sfxVolume, uiVolume, fx, laps: clampLaps(raw.laps), time, weather, livery: clampLivery(raw.livery), quality, knobs, hudScale: clampHudScale(raw.hudScale), colourSafe, reducedEffects, records: clampRecords(raw.records), frameCap: clampFrameCap(raw.frameCap), ghosts: clampGhosts(raw.ghosts) ?? [...DEFAULT_GHOSTS] }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Quality and knobs from a stored value. Before the presets, Reflections and FXAA were two flat booleans:
 * FXAA on (off was the default) kept as Custom on top of High; otherwise the save reads as High.
 */
function qualityOf(raw: Record<string, unknown>): { quality: Quality; knobs: Knobs } {
  if ('quality' in raw) return { quality: clampQuality(raw.quality), knobs: clampKnobs(raw.knobs) }
  if (raw.aa === true) return { quality: 'custom', knobs: { ...qualityKnobs('high'), aa: true, reflections: raw.reflections === true } }
  return { quality: 'high', knobs: qualityKnobs('high') }
}

/** Reduced effects in force: the player's choice, else the system's reduce-motion. */
export const reducedEffectsOn = (s: Pick<Settings, 'reducedEffects'>, systemReduced: boolean): boolean => s.reducedEffects ?? systemReduced

export function saveSettings(storage: KeyValueStore, s: Settings): void {
  storage.setItem(KEY, JSON.stringify(s))
}

/** `?fx=` wins when present (shared links, `make shots`); otherwise the saved effects. */
export function effectiveFxQuery(search: string, s: Settings): string {
  const q = new URLSearchParams(search)
  if (!q.has('fx') && s.fx.length > 0) q.set('fx', s.fx.join(','))
  return `?${q.toString()}`
}
