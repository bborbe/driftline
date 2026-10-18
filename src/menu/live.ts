// Live settings: what a Settings change means for the running race, so main.ts applies each part at
// once instead of on a reload. Pure and tested; main.ts owns the side effects (view, ghost, audio, race).
import type { Settings } from './settings'
import { LIVE_FX, type Fx } from '../render/fx/flags'
import { sameKnobs } from '../render/quality'

/** The parts of the running race a settings change touches; absent keys are unchanged. */
export interface SettingsChange {
  volume?: number
  sfxVolume?: number
  uiVolume?: number
  /** The live effects now on. */
  fx?: Set<Fx>
  /** Laps for the next restart. */
  laps?: number
  /** Time or weather changed: re-resolve the environment from the new choice. */
  environment?: true
  livery?: Settings['livery']
  /** Quality or a render knob changed: re-resolve the knobs (render/quality.ts effectiveKnobs) and apply them. */
  quality?: true
  /** Colour-safe HUD on or off. */
  colourSafe?: boolean
  /** Reduced effects choice changed (null: back to the system's reduce-motion). */
  reducedEffects?: boolean | null
}

const sameLivery = (a: Settings['livery'], b: Settings['livery']) => a.pattern === b.pattern && a.paint === b.paint && a.number === b.number

/** The live effects a settings value turns on. */
export const liveFx = (s: Pick<Settings, 'fx'>): Set<Fx> => new Set(LIVE_FX.filter((f) => s.fx.includes(f)))

export function settingsChange(prev: Settings, next: Settings): SettingsChange {
  const out: SettingsChange = {}
  if (prev.volume !== next.volume) out.volume = next.volume
  if (prev.sfxVolume !== next.sfxVolume) out.sfxVolume = next.sfxVolume
  if (prev.uiVolume !== next.uiVolume) out.uiVolume = next.uiVolume
  const a = liveFx(prev)
  const b = liveFx(next)
  if (a.size !== b.size || [...a].some((f) => !b.has(f))) out.fx = b
  if (prev.laps !== next.laps) out.laps = next.laps
  if (prev.time !== next.time || prev.weather !== next.weather) out.environment = true
  if (!sameLivery(prev.livery, next.livery)) out.livery = next.livery
  if (prev.quality !== next.quality || !sameKnobs(prev.knobs, next.knobs)) out.quality = true
  if (prev.colourSafe !== next.colourSafe) out.colourSafe = next.colourSafe
  if (prev.reducedEffects !== next.reducedEffects) out.reducedEffects = next.reducedEffects
  return out
}
