// Race HUD values (speed, speedometer ticks, the time to chase and its delta) and the debug-overlay switch. Pure and tested.
import type { Medals } from '../track/schema'
import { EFFECT_LABEL, EFFECT_LOOK } from '../render/track/effect-pads'
import type { ActiveEffect } from './effects'
import { MEDAL_LABEL, nextMedal, type Medal } from './medals'

/** Ticks on the speedometer arc. */
export const SPEEDO_TICKS = 24
/** Speed (km/h) that lights the whole arc. */
export const SPEEDO_MAX_KMH = 300

/** Forward speed in m/s to a whole km/h reading (never negative; reversing reads as its magnitude). */
export const kmh = (forwardMps: number): number => Math.round(Math.abs(forwardMps) * 3.6)

/** How many of `ticks` arc ticks are lit at `speedKmh`, clamped to 0..ticks. */
export function litTicks(speedKmh: number, ticks = SPEEDO_TICKS, maxKmh = SPEEDO_MAX_KMH): number {
  return Math.max(0, Math.min(ticks, Math.round((speedKmh / maxKmh) * ticks)))
}

export interface Target {
  /** `GOLD`, `AUTHOR`, … or `BEST` once every medal is earned (or the track has none). */
  label: string
  ms: number
  medal: Medal | null
}

/**
 * The time to chase this run: the next medal above the best one earned, or the personal best once
 * author is earned or the track carries no medals. Null when there is nothing to chase yet.
 */
export function chaseTarget(medals: Medals | undefined, bestMedal: Medal | null, bestMs: number | null): Target | null {
  const next = medals ? nextMedal(bestMedal) : null
  if (medals && next) return { label: MEDAL_LABEL[next], ms: medals[next], medal: next }
  return bestMs === null ? null : { label: 'BEST', ms: bestMs, medal: null }
}

/** One HUD chip per active effect pad: its label and its pad's colour (CSS hex). */
export interface EffectChip {
  label: string
  color: string
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

/** The active-effect chips, in the order the effects report them. A broken fragile car reads BROKEN. */
export function effectChips(active: readonly ActiveEffect[]): EffectChip[] {
  return active.map((e) =>
    e === 'broken' ? { label: 'BROKEN', color: css(EFFECT_LOOK.fragile.color) } : { label: EFFECT_LABEL[e], color: css(EFFECT_LOOK[e].color) },
  )
}

/**
 * The debug overlay (pose, fps, build label) is dev-only: `?dev=1` or `?debug=1` starts with it shown, `?debug=0` always
 * hides it, and a plain URL hides it so screenshots show the game, not debug noise. Backtick toggles it either way.
 */
export function debugVisible(search: string): boolean {
  const q = new URLSearchParams(search)
  if (q.get('debug') === '0') return false
  return q.get('debug') === '1' || q.get('dev') === '1'
}

/** Personal best vs the target time (ms; positive = still behind it), null without a best or for the BEST target itself. */
export const targetDelta = (target: Target | null, bestMs: number | null): number | null =>
  target === null || target.medal === null || bestMs === null ? null : bestMs - target.ms
