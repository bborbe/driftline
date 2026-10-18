// Settings tabs: which tab each control lives in, the remembered tab, and Q / E to switch. Pure and tested.
import type { KeyValueStore } from './settings'

/** Every control the settings panel builds, one id each. */
export const CONTROL_IDS = ['volume', 'sfxVolume', 'uiVolume', 'speedlines', 'smoke', 'camera', 'reflections', 'aa', 'laps', 'time', 'weather', 'livery', 'paint', 'number', 'hudScale', 'ghosts', 'build'] as const
export type ControlId = (typeof CONTROL_IDS)[number]

export const TABS = ['car', 'race', 'graphics', 'audio', 'about'] as const
export type Tab = (typeof TABS)[number]

export const TAB_LABELS: Record<Tab, string> = { car: 'Car', race: 'Race', graphics: 'Graphics', audio: 'Audio', about: 'About' }

/** The controls of each tab, in panel order; every control lives in exactly one tab (tabs.test.ts). */
export const TAB_CONTROLS: Record<Tab, readonly ControlId[]> = {
  car: ['livery', 'paint', 'number'],
  race: ['time', 'weather', 'laps', 'ghosts'],
  graphics: ['speedlines', 'smoke', 'camera', 'reflections', 'aa', 'hudScale'],
  audio: ['volume', 'sfxVolume', 'uiVolume'],
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
