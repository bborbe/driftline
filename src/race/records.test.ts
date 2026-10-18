import { describe, expect, it } from 'vitest'
import { clampRecords, isRecordsKey, medalDelta, NARROW_PX, recordRows, recordsOpen } from './records'

const medals = { author: 40000, gold: 45000, silver: 52000, bronze: 60000 }

describe('medalDelta', () => {
  it('is negative and beaten when the best is faster than the medal', () => {
    expect(medalDelta(44786, 45000)).toEqual({ text: '-0.214', beaten: true })
  })

  it('is positive and not beaten when the best is slower', () => {
    expect(medalDelta(40381, 40000)).toEqual({ text: '+0.381', beaten: false })
  })

  it('counts a tie as beaten, like earning the medal', () => {
    expect(medalDelta(45000, 45000)).toEqual({ text: '-0.000', beaten: true })
  })

  it('shows whole seconds past a minute without a minute field', () => {
    expect(medalDelta(125500, 60000).text).toBe('+65.500')
  })
})

describe('recordRows', () => {
  it('lists the PB then every medal best first, each with the best delta to it', () => {
    const rows = recordRows(medals, 48000)
    expect(rows.map((r) => [r.label, r.ms, r.delta?.text ?? null, r.delta?.beaten ?? null])).toEqual([
      ['PB', 48000, null, null],
      ['AUTHOR', 40000, '+8.000', false],
      ['GOLD', 45000, '+3.000', false],
      ['SILVER', 52000, '-4.000', true],
      ['BRONZE', 60000, '-12.000', true],
    ])
  })

  it('gives no deltas before a best exists', () => {
    const rows = recordRows(medals, null)
    expect(rows[0]).toEqual({ label: 'PB', kind: 'pb', ms: null, delta: null })
    expect(rows.slice(1).every((r) => r.delta === null)).toBe(true)
  })

  it('is the PB alone without medals (multi-lap runs, tracks without medals)', () => {
    expect(recordRows(undefined, 90000)).toEqual([{ label: 'PB', kind: 'pb', ms: 90000, delta: null }])
  })
})

describe('recordsOpen', () => {
  it('auto is open on wide windows and collapsed on narrow ones', () => {
    expect(recordsOpen('auto', NARROW_PX)).toBe(true)
    expect(recordsOpen('auto', NARROW_PX - 1)).toBe(false)
  })

  it('open and closed ignore the width', () => {
    expect(recordsOpen('open', 400)).toBe(true)
    expect(recordsOpen('closed', 2000)).toBe(false)
  })
})

describe('clampRecords', () => {
  it('keeps a known choice and falls back to auto', () => {
    expect(clampRecords('closed')).toBe('closed')
    expect(clampRecords('maybe')).toBe('auto')
    expect(clampRecords(undefined)).toBe('auto')
  })
})

it('T toggles the panel', () => {
  expect(isRecordsKey('KeyT')).toBe(true)
  expect(isRecordsKey('KeyR')).toBe(false)
})
