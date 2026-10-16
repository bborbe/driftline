// Camera view selection: 1 = close chase, 2 = far chase, 3 = in-car. The choice persists in localStorage.
import type { KeyValueStore } from '../race/store'

export const VIEWS = ['close', 'far', 'cockpit'] as const
export type ViewMode = (typeof VIEWS)[number]
export const VIEW_KEY = 'driftline.camera'

const KEYS: Record<string, ViewMode> = { Digit1: 'close', Digit2: 'far', Digit3: 'cockpit', Numpad1: 'close', Numpad2: 'far', Numpad3: 'cockpit' }

/** The view a key code selects, or null for any other key. */
export const viewForKey = (code: string): ViewMode | null => KEYS[code] ?? null

export const loadView = (store: KeyValueStore): ViewMode => {
  const v = store.getItem(VIEW_KEY)
  return (VIEWS as readonly string[]).includes(v ?? '') ? (v as ViewMode) : 'close'
}

export const saveView = (store: KeyValueStore, mode: ViewMode): void => store.setItem(VIEW_KEY, mode)
