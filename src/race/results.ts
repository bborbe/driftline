// Results screen data: what the card after the finish shows (medal, time, best, delta, one split row per checkpoint
// and lap line vs the previous best, with the sector before it — "where did I lose time" — and the worst sector marked). Built from the race state at the finish; pure and tested. The card itself is
// drawn by RaceView.showResults (view.ts), after the finish orbit has played for RESULTS_HOLD_MS.
import type { Medal } from './medals'

/** How long the finish orbit plays clear of the card before the results card fades in. */
export const RESULTS_HOLD_MS = 1200

export interface MedalResult {
  earned: Medal | null
  next: Medal | null
  nextMs: number | null
  best: Medal | null
}

export interface SplitRow {
  /** Row label: `CP 2`, or in a multi-lap run `L2 CP1` and `LAP 1` for each lap line. */
  label: string
  /** Run time at this split (ms). */
  ms: number
  /** The previous best's split here; null without one. */
  pbMs: number | null
  /** Against the previous best's split; null without one. */
  deltaMs: number | null
  /** Time since the split before (the first sector runs from the start). */
  sectorMs: number
  /** The previous best's sector here; null without one. */
  pbSectorMs: number | null
  /** This sector against the previous best's: positive = time lost here; null without one. */
  sectorDeltaMs: number | null
  /** The sector that lost the most time vs the previous best (at most one row; none when every sector gained). */
  worst: boolean
}

export interface Results {
  ms: number
  isNewBest: boolean
  /** The best before this run (ms), null on a first finish. */
  previousBest: number | null
  /** This run vs the previous best; null without one. */
  deltaMs: number | null
  /** Each lap of a multi-lap run; empty in a single-lap run. */
  lapTimes: number[]
  splits: SplitRow[]
  medal: MedalResult | null
}

export interface ResultsInput {
  ms: number
  isNewBest: boolean
  previousBest: number | null
  deltaMs: number | null
  lapTimes: number[]
  /** SplitTracker.splits: run time at each split, numbered on across laps (checkpoints, then the lap line). */
  splits: number[]
  /** The previous best's splits, captured at the run start; null without one. */
  previousSplits: number[] | null
  /** Checkpoints per lap (the lap line not counted). */
  checkpoints: number
  laps: number
  medal: MedalResult | null
}

/** Label for split `i` (0-based): per lap, its checkpoints then its lap line. */
export function splitLabel(i: number, checkpoints: number, laps: number): string {
  const perLap = checkpoints + 1
  const lap = Math.floor(i / perLap) + 1
  const within = i % perLap
  if (within === checkpoints) return `LAP ${lap}`
  return laps > 1 ? `L${lap} CP${within + 1}` : `CP ${within + 1}`
}

/** Sector times from split times: each split minus the one before, the first from the start (0). */
export const sectorTimes = (splits: readonly number[]): number[] => splits.map((ms, i) => ms - (i === 0 ? 0 : splits[i - 1]))

/** Index of the sector that lost the most time (largest positive delta), or -1 when none lost time. */
export function worstSector(deltas: readonly (number | null)[]): number {
  let worst = -1
  deltas.forEach((d, i) => {
    if (d !== null && d > 0 && (worst < 0 || d > (deltas[worst] as number))) worst = i
  })
  return worst
}

export function buildResults(r: ResultsInput): Results {
  const sectors = sectorTimes(r.splits)
  // The previous best's sectors, only over the splits it has (a best stored with fewer splits compares partly).
  const pb = r.previousSplits ? r.previousSplits.slice(0, r.splits.length) : null
  const pbSectors = pb ? sectorTimes(pb) : null
  const sectorDeltas = sectors.map((ms, i) => (pbSectors?.[i] === undefined ? null : ms - pbSectors[i]))
  const worst = worstSector(sectorDeltas)
  const splits: SplitRow[] = r.splits.map((ms, i) => {
    const pbMs = pb?.[i] ?? null
    return {
      label: splitLabel(i, r.checkpoints, r.laps),
      ms,
      pbMs,
      deltaMs: pbMs === null ? null : ms - pbMs,
      sectorMs: sectors[i],
      pbSectorMs: pbSectors?.[i] ?? null,
      sectorDeltaMs: sectorDeltas[i],
      worst: i === worst,
    }
  })
  return {
    ms: r.ms,
    isNewBest: r.isNewBest,
    previousBest: r.previousBest,
    deltaMs: r.deltaMs,
    lapTimes: r.laps > 1 ? r.lapTimes : [],
    splits,
    medal: r.medal,
  }
}
