// Records panel (top left, T): the personal best and every medal time with the best's delta to it, then the local
// top 5. Open, closed or auto (collapsed on narrow windows) from Settings → Graphics → Records panel (`?rec=`). Pure and tested.
import type { Medals } from '../track/schema'
import { MEDAL_LABEL, MEDAL_ORDER, type Medal } from './medals'

/** Settings choice: open unless the window is narrower than NARROW_PX, always open, or always collapsed. */
export const RECORDS_CHOICES = ['auto', 'open', 'closed'] as const
export type RecordsChoice = (typeof RECORDS_CHOICES)[number]

/** Below this window width (px) `auto` starts the panel collapsed. */
export const NARROW_PX = 900
/** Leaderboard entries the panel lists. */
export const RECORDS_TOP = 5

/** The stored choice when it is one of RECORDS_CHOICES, else `auto`. */
export const clampRecords = (v: unknown): RecordsChoice => ((RECORDS_CHOICES as readonly unknown[]).includes(v) ? (v as RecordsChoice) : 'auto')

/** Whether the panel starts open for `choice` in a window `widthPx` wide. */
export const recordsOpen = (choice: RecordsChoice, widthPx: number): boolean => (choice === 'auto' ? widthPx >= NARROW_PX : choice === 'open')

/** T toggles the panel. */
export const isRecordsKey = (code: string): boolean => code === 'KeyT'

/**
 * The personal best's delta to a medal time: "-0.214" when the best beats it, "+0.381" while it is still behind.
 * A tie counts as beaten, as it does for earning the medal (earnedMedal).
 */
export function medalDelta(bestMs: number, medalMs: number): { text: string; beaten: boolean } {
  const beaten = bestMs <= medalMs
  return { text: `${beaten ? '-' : '+'}${(Math.abs(Math.round(bestMs - medalMs)) / 1000).toFixed(3)}`, beaten }
}

export interface RecordRow {
  /** `PB`, `AUTHOR`, `GOLD`, … */
  label: string
  /** `pb` or the medal; picks the row's colour. */
  kind: Medal | 'pb'
  /** The time, null for a PB not set yet. */
  ms: number | null
  /** The best's delta to this medal, null on the PB row and without a best. */
  delta: { text: string; beaten: boolean } | null
}

/** PB first, then author → bronze when the run has medals (single-lap runs only; a multi-lap run passes none). */
export function recordRows(medals: Medals | undefined, bestMs: number | null): RecordRow[] {
  const rows: RecordRow[] = [{ label: 'PB', kind: 'pb', ms: bestMs, delta: null }]
  if (!medals) return rows
  for (const m of MEDAL_ORDER) rows.push({ label: MEDAL_LABEL[m], kind: m, ms: medals[m], delta: bestMs === null ? null : medalDelta(bestMs, medals[m]) })
  return rows
}
