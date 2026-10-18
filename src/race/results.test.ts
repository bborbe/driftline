import { describe, expect, it } from 'vitest'
import { buildResults, splitLabel, type ResultsInput } from './results'

const base: ResultsInput = {
  ms: 35_214,
  isNewBest: false,
  previousBest: 34_000,
  deltaMs: 1_214,
  lapTimes: [35_214],
  splits: [8_000, 17_500, 26_900],
  previousSplits: [7_800, 17_600, 26_000],
  checkpoints: 3,
  laps: 1,
  medal: { earned: 'silver', next: 'gold', nextMs: 34_000, best: 'gold' },
}

describe('splitLabel', () => {
  it('numbers checkpoints in a single-lap run', () => {
    expect([0, 1, 2].map((i) => splitLabel(i, 3, 1))).toEqual(['CP 1', 'CP 2', 'CP 3'])
  })
  it('names each lap line and prefixes checkpoints with the lap in a multi-lap run', () => {
    expect([0, 1, 2, 3, 4].map((i) => splitLabel(i, 2, 2))).toEqual(['L1 CP1', 'L1 CP2', 'LAP 1', 'L2 CP1', 'L2 CP2'])
  })
})

describe('buildResults', () => {
  it('gives one split row per checkpoint with its delta vs the previous best', () => {
    const r = buildResults(base)
    expect(r.splits).toEqual([
      { label: 'CP 1', ms: 8_000, deltaMs: 200 },
      { label: 'CP 2', ms: 17_500, deltaMs: -100 },
      { label: 'CP 3', ms: 26_900, deltaMs: 900 },
    ])
  })
  it('leaves deltas null without a previous best', () => {
    const r = buildResults({ ...base, previousBest: null, deltaMs: null, previousSplits: null })
    expect(r.splits.map((s) => s.deltaMs)).toEqual([null, null, null])
    expect(r.deltaMs).toBeNull()
  })
  it('keeps the medal, time and best', () => {
    const r = buildResults(base)
    expect(r.medal?.earned).toBe('silver')
    expect(r.ms).toBe(35_214)
    expect(r.previousBest).toBe(34_000)
  })
  it('lists lap times only in a multi-lap run', () => {
    expect(buildResults(base).lapTimes).toEqual([])
    expect(buildResults({ ...base, laps: 2, lapTimes: [17_000, 16_500], checkpoints: 1, splits: [8_000, 17_000, 25_000], previousSplits: null }).lapTimes).toEqual([17_000, 16_500])
  })
  it('handles a previous best with fewer splits than this run', () => {
    expect(buildResults({ ...base, previousSplits: [7_800] }).splits.map((s) => s.deltaMs)).toEqual([200, null, null])
  })
})
