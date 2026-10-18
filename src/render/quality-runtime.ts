// Graphics quality and the Access options in the running game: resolves the knobs a quality setting draws
// with (render/quality.ts), runs Auto's frame-time probe on a device that has none stored, applies every
// Settings change at once, and keeps the Access body classes (colour-safe HUD, reduced effects) in step.
// main.ts creates it once and feeds frame(dt); nothing here reaches physics.
import { reducedEffectsOn, SETTINGS_EVENT, type Settings } from '../menu/settings'
import { deviceKey, effectiveKnobs, loadAutoQuality, QualityProbe, saveAutoQuality, type Knobs, type Preset } from './quality'
import type { View } from './view'

/** Window event the panel's Re-probe button fires: forget Auto's pick and probe again from now. */
export const REPROBE_EVENT = 'driftline:quality-reprobe'
/** Window event fired once Auto has picked; detail is the preset. */
export const AUTO_PICKED_EVENT = 'driftline:quality-auto'

export type QualityRuntime = {
  /** Feed every frame's dt; while Auto probes it measures, then applies the pick. */
  frame: (dt: number) => void
  /** What is drawn now (also on window.__driftlineQuality, for automated checks). */
  state: () => { quality: Settings['quality']; auto: Preset | null; knobs: Knobs; probing: boolean }
}

const systemReduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The device key Auto's pick is stored under (render/quality.ts deviceKey). */
export const thisDevice = (): string => deviceKey(navigator.userAgent, window.devicePixelRatio)

/** Auto's stored pick for this device, if any: the panel names it next to the Auto button. */
export const storedAuto = (): Preset | null => loadAutoQuality(localStorage, thisDevice())

/** The knobs `s` draws with on this device right now (Auto: its stored pick, High until probed). */
export const knobsFor = (s: Pick<Settings, 'quality' | 'knobs'>): Knobs => effectiveKnobs(s.quality, s.knobs, storedAuto())

/** Whether reduced effects is in force for `s` on this system. */
export const reducedFor = (s: Pick<Settings, 'reducedEffects'>): boolean => reducedEffectsOn(s, systemReduced())

/** Set the Access body classes for `s`. */
export function applyAccess(s: Pick<Settings, 'colourSafe' | 'reducedEffects'>): void {
  document.body.classList.toggle('colour-safe', s.colourSafe)
  document.body.classList.toggle('reduced-effects', reducedFor(s))
}

export function startQuality(view: Pick<View, 'setKnobs' | 'setReduced'>, initial: Settings): QualityRuntime {
  const device = thisDevice()
  let settings = initial
  let auto = loadAutoQuality(localStorage, device)
  let probe: QualityProbe | null = null
  const startProbe = () => {
    probe = settings.quality === 'auto' && auto === null ? new QualityProbe() : null
  }
  const apply = () => view.setKnobs(effectiveKnobs(settings.quality, settings.knobs, auto))
  startProbe()
  applyAccess(settings)
  view.setReduced(reducedFor(settings))
  window.addEventListener(SETTINGS_EVENT, (e) => {
    const next = (e as CustomEvent<Settings>).detail
    const qualityChanged = next.quality !== settings.quality
    settings = next
    if (qualityChanged) startProbe()
    apply()
    applyAccess(settings)
    view.setReduced(reducedFor(settings))
  })
  window.addEventListener(REPROBE_EVENT, () => {
    auto = null
    saveAutoQuality(localStorage, device, null)
    startProbe()
    apply() // High while it measures
  })
  const state = () => ({ quality: settings.quality, auto, knobs: effectiveKnobs(settings.quality, settings.knobs, auto), probing: probe !== null })
  ;(window as unknown as { __driftlineQuality: typeof state }).__driftlineQuality = state
  return {
    frame: (dt: number) => {
      if (!probe) return
      const picked = probe.push(dt)
      if (!picked) return
      probe = null
      auto = picked
      saveAutoQuality(localStorage, device, picked)
      apply()
      console.log(`quality: auto → ${picked}`)
      window.dispatchEvent(new CustomEvent(AUTO_PICKED_EVENT, { detail: picked }))
    },
    state,
  }
}
