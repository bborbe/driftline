// Player settings shown on the start screen and in the Esc menu, persisted in localStorage. Pure and tested.
import { FX, type Fx } from '../render/fx/flags'
import { clampLaps } from '../race/lap'
import { choiceOf, DEFAULT_CHOICE, TIME_CHOICES, WEATHER_CHOICES, type TimeChoice, type WeatherChoice } from '../track/environment'
import { clampLivery, DEFAULT_LIVERY, type Livery } from '../render/car/livery'

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
}

const KEY = 'driftline-settings'
export const DEFAULT_SETTINGS: Settings = { volume: 0.7, sfxVolume: 1, uiVolume: 1, fx: [], laps: 1, ...DEFAULT_CHOICE, livery: DEFAULT_LIVERY }
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
    return { volume, sfxVolume, uiVolume, fx, laps: clampLaps(raw.laps), time, weather, livery: clampLivery(raw.livery) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(storage: KeyValueStore, s: Settings): void {
  storage.setItem(KEY, JSON.stringify(s))
}

/** `?fx=` wins when present (shared links, `make shots`); otherwise the saved effects. */
export function effectiveFxQuery(search: string, s: Settings): string {
  const q = new URLSearchParams(search)
  if (!q.has('fx') && s.fx.length > 0) q.set('fx', s.fx.join(','))
  return `?${q.toString()}`
}
