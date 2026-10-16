// Per-track medal targets and checkpoint split deltas. Pure and tested.
import type { Medals } from '../track/schema'

export type Medal = keyof Medals

/** Best first. */
export const MEDAL_ORDER: Medal[] = ['author', 'gold', 'silver', 'bronze']

export const MEDAL_LABEL: Record<Medal, string> = { author: 'AUTHOR', gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' }

/** The best medal a lap time earns, or null when it misses bronze. */
export function earnedMedal(medals: Medals, lapTimeMs: number): Medal | null {
  return MEDAL_ORDER.find((m) => lapTimeMs <= medals[m]) ?? null
}

/** The next medal to chase above `earned` (bronze when none earned), or null at author. */
export function nextMedal(earned: Medal | null): Medal | null {
  if (earned === null) return 'bronze'
  const i = MEDAL_ORDER.indexOf(earned)
  return i > 0 ? MEDAL_ORDER[i - 1] : null
}

/** Is `a` a better medal than `b` (null = no medal)? */
export function isBetterMedal(a: Medal | null, b: Medal | null): boolean {
  if (a === null) return false
  return b === null || MEDAL_ORDER.indexOf(a) < MEDAL_ORDER.indexOf(b)
}

/** Split delta vs the personal best, e.g. "-0.214" (ahead) or "+0.381" (behind). */
export function formatDelta(deltaMs: number): string {
  const ms = Math.round(deltaMs)
  return `${ms < 0 ? '-' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`
}

/**
 * Tracks one lap's checkpoint times against the personal best captured at lap start. Deltas are
 * null when there is no best to compare with (first lap, or a best stored without splits).
 */
export class SplitTracker {
  private bestSplits: number[] | null = null
  private bestLapMs: number | null = null
  /** Lap time (ms) at each checkpoint passed this lap. */
  splits: number[] = []

  begin(bestLapMs: number | null, bestSplits: number[] | null): void {
    this.bestLapMs = bestLapMs
    this.bestSplits = bestLapMs === null ? null : bestSplits
    this.splits = []
  }

  /** Checkpoint `index` (1-based) passed at `lapMs`; returns the delta vs the best, or null. */
  checkpoint(index: number, lapMs: number): number | null {
    this.splits[index - 1] = lapMs
    const best = this.bestSplits?.[index - 1]
    return best === undefined ? null : lapMs - best
  }

  /** Finish at `lapMs`; returns the delta vs the best lap, or null. */
  finish(lapMs: number): number | null {
    return this.bestLapMs === null ? null : lapMs - this.bestLapMs
  }
}
