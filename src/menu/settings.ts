// Player settings shown on the start screen and in the Esc menu, persisted in localStorage. Pure and tested.
import { FX, type Fx } from '../render/fx/flags'

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

export interface Settings {
  volume: number
  fx: Fx[]
}

const KEY = 'driftline-settings'
export const DEFAULT_SETTINGS: Settings = { volume: 0.7, fx: [] }

export function loadSettings(storage: KeyValueStore): Settings {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    const volume = Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : DEFAULT_SETTINGS.volume
    const fx = Array.isArray(raw.fx) ? FX.filter((f) => raw.fx.includes(f)) : []
    return { volume, fx }
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
