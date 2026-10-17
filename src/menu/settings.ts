// Player settings shown on the start screen and in the Esc menu, persisted in localStorage. Pure and tested.
import { FX, type Fx } from '../render/fx/flags'
import { clampLaps } from '../race/lap'
import { ENVIRONMENT_MODES, type EnvironmentMode } from '../track/environment'

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

export interface Settings {
  volume: number
  fx: Fx[]
  /** Laps per race; `?laps=` overrides it. */
  laps: number
  /** Time of day and weather: the track's own default, or a random preset per race (`?time=` / `?weather=` / `?seed=` override it). */
  environment: EnvironmentMode
}

const KEY = 'driftline-settings'
export const DEFAULT_SETTINGS: Settings = { volume: 0.7, fx: [], laps: 1, environment: 'fixed' }

export function loadSettings(storage: KeyValueStore): Settings {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    const volume = Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : DEFAULT_SETTINGS.volume
    const fx = Array.isArray(raw.fx) ? FX.filter((f) => raw.fx.includes(f)) : []
    const environment = (ENVIRONMENT_MODES as readonly unknown[]).includes(raw.environment) ? (raw.environment as EnvironmentMode) : DEFAULT_SETTINGS.environment
    return { volume, fx, laps: clampLaps(raw.laps), environment }
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
