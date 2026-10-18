import { describe, expect, it } from 'vitest'
import { buildResults, sectorTimes, splitLabel, worstSector, type ResultsInput } from './results'

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
    expect(r.splits.map(({ label, ms, pbMs, deltaMs }) => ({ label, ms, pbMs, deltaMs }))).toEqual([
      { label: 'CP 1', ms: 8_000, pbMs: 7_800, deltaMs: 200 },
      { label: 'CP 2', ms: 17_500, pbMs: 17_600, deltaMs: -100 },
      { label: 'CP 3', ms: 26_900, pbMs: 26_000, deltaMs: 900 },
    ])
  })
  it('gives each row its sector vs the previous best sector and marks the worst', () => {
    // sectors 8000 / 9500 / 9400 vs PB 7800 / 9800 / 8400: +200, -300, +1000 -> CP 3 lost the most
    const r = buildResults(base)
    expect(r.splits.map(({ sectorMs, pbSectorMs, sectorDeltaMs, worst }) => ({ sectorMs, pbSectorMs, sectorDeltaMs, worst }))).toEqual([
      { sectorMs: 8_000, pbSectorMs: 7_800, sectorDeltaMs: 200, worst: false },
      { sectorMs: 9_500, pbSectorMs: 9_800, sectorDeltaMs: -300, worst: false },
      { sectorMs: 9_400, pbSectorMs: 8_400, sectorDeltaMs: 1_000, worst: true },
    ])
  })
  it('marks no sector when every one gained on the previous best', () => {
    const r = buildResults({ ...base, splits: [7_700, 17_000, 25_000] })
    expect(r.splits.some((s) => s.worst)).toBe(false)
  })
  it('leaves deltas null without a previous best', () => {
    const r = buildResults({ ...base, previousBest: null, deltaMs: null, previousSplits: null })
    expect(r.splits.map((s) => s.deltaMs)).toEqual([null, null, null])
    expect(r.splits.map((s) => [s.pbMs, s.pbSectorMs, s.sectorDeltaMs, s.worst])).toEqual([
      [null, null, null, false],
      [null, null, null, false],
      [null, null, null, false],
    ])
    expect(r.splits.map((s) => s.sectorMs)).toEqual([8_000, 9_500, 9_400])
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
    const r = buildResults({ ...base, previousSplits: [7_800] })
    expect(r.splits.map((s) => s.deltaMs)).toEqual([200, null, null])
    expect(r.splits.map((s) => s.sectorDeltaMs)).toEqual([200, null, null])
    expect(r.splits.map((s) => s.worst)).toEqual([true, false, false])
  })
})

describe('sectorTimes', () => {
  it('is each split minus the one before, the first from the start', () => {
    expect(sectorTimes([8_000, 17_500, 26_900])).toEqual([8_000, 9_500, 9_400])
    expect(sectorTimes([])).toEqual([])
  })
})

describe('worstSector', () => {
  it('picks the largest positive delta', () => {
    expect(worstSector([200, -300, 1_000, 999])).toBe(2)
  })
  it('keeps the first of equal worst deltas', () => {
    expect(worstSector([500, 500])).toBe(0)
  })
  it('is -1 when no sector lost time or there is nothing to compare', () => {
    expect(worstSector([-1, 0, -5])).toBe(-1)
    expect(worstSector([null, null])).toBe(-1)
    expect(worstSector([])).toBe(-1)
  })
})

