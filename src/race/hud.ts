// Race HUD values (speed, speedometer ticks, the time to chase) and the debug-overlay switch. Pure and tested.
import type { Medals } from '../track/schema'
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

/** `?debug=0` starts with the debug overlay hidden (backtick toggles it); it is shown by default (agents read it in screenshots). */
export const debugVisible = (search: string): boolean => new URLSearchParams(search).get('debug') !== '0'
