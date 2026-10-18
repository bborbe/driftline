// Results screen data: what the card after the finish shows (medal, time, best, delta, one split row per checkpoint
// and lap line vs the previous best). Built from the race state at the finish; pure and tested. The card itself is
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
  /** Against the previous best's split; null without one. */
  deltaMs: number | null
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

export function buildResults(r: ResultsInput): Results {
  const splits: SplitRow[] = []
  r.splits.forEach((ms, i) => {
    const best = r.previousSplits?.[i]
    splits.push({ label: splitLabel(i, r.checkpoints, r.laps), ms, deltaMs: best === undefined ? null : ms - best })
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
