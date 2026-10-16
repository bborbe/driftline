import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validate, type Track } from '../track/schema'
import { earnedMedal, formatDelta, isBetterMedal, MEDAL_ORDER, nextMedal, SplitTracker } from './medals'

const MEDALS = { author: 10_000, gold: 12_000, silver: 15_000, bronze: 20_000 }

describe('medals', () => {
  it('earns the best medal the time beats, inclusive', () => {
    expect(earnedMedal(MEDALS, 9_000)).toBe('author')
    expect(earnedMedal(MEDALS, 12_000)).toBe('gold')
    expect(earnedMedal(MEDALS, 14_999)).toBe('silver')
    expect(earnedMedal(MEDALS, 20_000)).toBe('bronze')
    expect(earnedMedal(MEDALS, 20_001)).toBeNull()
  })

  it('names the next medal to chase', () => {
    expect(nextMedal(null)).toBe('bronze')
    expect(nextMedal('bronze')).toBe('silver')
    expect(nextMedal('gold')).toBe('author')
    expect(nextMedal('author')).toBeNull()
  })

  it('ranks medals', () => {
    expect(isBetterMedal('gold', 'silver')).toBe(true)
    expect(isBetterMedal('silver', 'gold')).toBe(false)
    expect(isBetterMedal('bronze', null)).toBe(true)
    expect(isBetterMedal(null, null)).toBe(false)
  })

  it.each(['lap1', 'lap2'])('%s ships four strictly ordered medal times', (name) => {
    const track = JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as Track
    expect(validate(track)).toEqual([])
    const times = MEDAL_ORDER.map((m) => track.medals![m])
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true)
  })
})

describe('formatDelta', () => {
  it('signs ahead negative and behind positive, to the millisecond', () => {
    expect(formatDelta(-214)).toBe('-0.214')
    expect(formatDelta(381)).toBe('+0.381')
    expect(formatDelta(12345.6)).toBe('+12.346')
    expect(formatDelta(0)).toBe('+0.000')
  })
})

describe('SplitTracker', () => {
  it('has no deltas without a personal best', () => {
    const t = new SplitTracker()
    t.begin(null, [1000])
    expect(t.checkpoint(1, 900)).toBeNull()
    expect(t.finish(5000)).toBeNull()
    expect(t.splits).toEqual([900])
  })

  it('compares each checkpoint and the finish with the best run', () => {
    const t = new SplitTracker()
    t.begin(5000, [1000, 2500])
    expect(t.checkpoint(1, 786)).toBe(-214)
    expect(t.checkpoint(2, 2881)).toBe(381)
    expect(t.finish(4900)).toBe(-100)
    expect(t.splits).toEqual([786, 2881])
    t.begin(4900, t.splits) // next lap starts fresh
    expect(t.splits).toEqual([])
    expect(t.checkpoint(1, 800)).toBe(14)
  })
})
