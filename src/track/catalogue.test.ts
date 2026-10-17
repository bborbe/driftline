import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAMPAIGN, menuOrder, nextInGroup, recordName, resolveAlias, STYLES, TEST_TRACKS, TIERS, trackGroups } from './catalogue'

const shipped = readdirSync(new URL('../../assets/track/', import.meta.url))
  .filter((f) => f.endsWith('.json') && f !== 'pieces.json')
  .map((f) => f.slice(0, -'.json'.length))

describe('track catalogue', () => {
  it('splits tracks into a Campaign group and a Test group, campaign first', () => {
    const groups = trackGroups(['test2', 'tower', 'test-ramp', 'crossover', 'test1'])
    expect(groups.map((g) => g.id)).toEqual(['campaign', 'test'])
    expect(groups[0].entries).toEqual([
      { track: 'crossover', label: 'A01', tier: 'white' },
      { track: 'tower', label: 'A02', tier: 'white' },
    ])
    expect(groups[1].entries.map((e) => e.track)).toEqual(['test1', 'test2', 'test-ramp'])
  })

  it('leaves out campaign levels not shipped yet and empty groups', () => {
    expect(trackGroups(['test1', 'test2']).map((g) => g.id)).toEqual(['test'])
  })

  it('appends unlisted tracks to the end of their group', () => {
    expect(menuOrder(['zz-new', 'crossover', 'test-zz', 'test1'])).toEqual(['crossover', 'zz-new', 'test1', 'test-zz'])
  })

  it('Next walks within the group and wraps to its first track', () => {
    const names = ['crossover', 'tower', 'test1', 'test2', 'test-flat']
    expect(nextInGroup('crossover', names)).toBe('tower')
    expect(nextInGroup('tower', names)).toBe('crossover')
    expect(nextInGroup('test2', names)).toBe('test-flat')
    expect(nextInGroup('test-flat', names)).toBe('test1')
    expect(nextInGroup('unknown', names)).toBe('crossover')
  })

  it('old lap names resolve to the renamed tests, and the tests keep their old record names', () => {
    expect(resolveAlias('lap1')).toBe('test1')
    expect(resolveAlias('lap2')).toBe('test2')
    expect(resolveAlias('test-flat')).toBe('test-flat')
    expect(recordName('test1')).toBe('lap1')
    expect(recordName('test2')).toBe('lap2')
    expect(recordName('crossover')).toBe('crossover')
  })

  it('campaign levels are numbered uniquely with a known tier, tiers never get easier', () => {
    expect(new Set(CAMPAIGN.map((l) => l.id)).size).toBe(CAMPAIGN.length)
    for (const l of CAMPAIGN) expect(l.id).toMatch(/^[A-Z]\d{2}$/)
    const ranks = CAMPAIGN.map((l) => TIERS.indexOf(l.tier))
    expect(ranks.every((r, i) => r >= 0 && (i === 0 || r >= ranks[i - 1]))).toBe(true)
  })

  it('every campaign level ships, so the Campaign group lists A01-A05 in order, then the unlisted showcase', () => {
    for (const l of CAMPAIGN) expect(shipped).toContain(l.track)
    expect(trackGroups(shipped)[0].entries.map((e) => e.label)).toEqual(['A01', 'A02', 'A03', 'A04', 'A05', 'showcase'])
  })

  it('splits the style tracks into their own group, between Campaign and Test, S01-S07 in order', () => {
    const groups = trackGroups(shipped)
    expect(groups.map((g) => g.id)).toEqual(['campaign', 'styles', 'test'])
    expect(groups[1].title).toBe('Styles')
    expect(groups[1].entries.map((e) => e.label)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'])
    for (const l of STYLES) {
      expect(shipped).toContain(l.track)
      expect(TIERS).toContain(l.tier)
      expect(groups[0].entries.map((e) => e.track)).not.toContain(l.track)
    }
    expect(nextInGroup('washboard', shipped)).toBe('looping')
    expect(nextInGroup('looping', shipped)).toBe('velodrome')
    expect(nextInGroup('velodrome', shipped)).toBe('switchback')
    expect(nextInGroup('switchback', shipped)).toBe('flatout')
  })

  it('every listed test track ships, and ≥ 5 single-feature test tracks exist', () => {
    for (const t of TEST_TRACKS) expect(shipped).toContain(t)
    expect(shipped.filter((n) => n.startsWith('test-')).length).toBeGreaterThanOrEqual(5)
  })
})
