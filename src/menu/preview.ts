// Track-select preview panel data (src/menu/start.ts): every medal time of the focused track against the personal best.
// Pure and tested.
import { MEDAL_ORDER, type Medal } from '../race/medals'
import type { Medals } from '../track/schema'

export interface MedalRow {
  medal: Medal
  ms: number
  /** PB minus the medal time: negative = the PB beats it (blue), positive = still to find (red); null without a PB. */
  deltaMs: number | null
}

export function medalRows(medals: Medals | undefined, pb: number | null): MedalRow[] {
  if (!medals) return []
  return MEDAL_ORDER.map((medal) => ({ medal, ms: medals[medal], deltaMs: pb === null ? null : pb - medals[medal] }))
}

/** URL of a track's tile thumbnail (scripts/thumbs.mjs → public/thumbs/); `drive` is its chase-camera frame. */
export const thumbUrl = (base: string, track: string, kind: 'top' | 'drive' = 'top'): string =>
  `${base.endsWith('/') ? base : `${base}/`}thumbs/${track}${kind === 'drive' ? '-drive' : ''}.webp`
