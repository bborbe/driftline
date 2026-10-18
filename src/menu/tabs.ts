// Settings tabs: which tab each control lives in, the remembered tab, and Q / E to switch. Pure and tested.
import type { KeyValueStore } from './settings'

/** Every control the settings panel builds, one id each. */
export const CONTROL_IDS = ['volume', 'sfxVolume', 'uiVolume', 'quality', 'advanced', 'speedlines', 'smoke', 'camera', 'laps', 'time', 'weather', 'livery', 'paint', 'number', 'name', 'hudScale', 'records', 'frameCap', 'bindings', 'colourSafe', 'reducedEffects', 'ghosts', 'build'] as const
export type ControlId = (typeof CONTROL_IDS)[number]

export const TABS = ['car', 'race', 'graphics', 'controls', 'audio', 'access', 'about'] as const
export type Tab = (typeof TABS)[number]

export const TAB_LABELS: Record<Tab, string> = { car: 'Car', race: 'Race', graphics: 'Graphics', controls: 'Controls', audio: 'Audio', access: 'Access', about: 'About' }

/** The controls of each tab, in panel order; every control lives in exactly one tab (tabs.test.ts). */
export const TAB_CONTROLS: Record<Tab, readonly ControlId[]> = {
  car: ['livery', 'paint', 'number', 'name'],
  race: ['time', 'weather', 'laps', 'ghosts'],
  // Reflections and FXAA sit in the Advanced fold-out with the other quality knobs (render/quality.ts).
  graphics: ['quality', 'speedlines', 'smoke', 'camera', 'hudScale', 'records', 'frameCap', 'advanced'],
  controls: ['bindings'],
  audio: ['volume', 'sfxVolume', 'uiVolume'],
  access: ['colourSafe', 'reducedEffects'],
  about: ['build'],
}

const KEY = 'driftline-settings-tab'
export const DEFAULT_TAB: Tab = 'car'

export function loadTab(storage: KeyValueStore): Tab {
  const raw = storage.getItem(KEY)
  return (TABS as readonly (string | null)[]).includes(raw) ? (raw as Tab) : DEFAULT_TAB
}

export function saveTab(storage: KeyValueStore, tab: Tab): void {
  storage.setItem(KEY, tab)
}

/** Tab after a key press: Q previous, E next, both wrap; anything else keeps it. */
export function moveTab(tab: Tab, code: string): Tab {
  const i = TABS.indexOf(tab)
  if (code === 'KeyE') return TABS[(i + 1) % TABS.length]
  if (code === 'KeyQ') return TABS[(i - 1 + TABS.length) % TABS.length]
  return tab
}
