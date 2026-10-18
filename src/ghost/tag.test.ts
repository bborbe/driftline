import { describe, expect, it } from 'vitest'
import { ghostsFromQuery, ghostsQuery, offeredGhosts, tagText, timeAtPoint } from './tag'

describe('ghost tag text', () => {
  it('shows the ghost finish time before the car passes a checkpoint', () => {
    expect(tagText('gold', 30_000, null)).toEqual({ name: 'Gold', detail: '0:30.000', ahead: null })
  })

  it('shows place, the ghost split and car − ghost: + when the ghost is ahead', () => {
    // Car 9.569 s at the checkpoint, Author 9.562 s, Gold 9.700 s: the author is 1st and 0.007 ahead of the car.
    const field = [9_569, 9_562, 9_700]
    expect(tagText('author', 9_562, 9_569, field)).toEqual({ name: 'Author', detail: '1st 0:09.562 +0.007', ahead: true })
    expect(tagText('gold', 9_700, 9_569, field)).toEqual({ name: 'Gold', detail: '3rd 0:09.700 -0.131', ahead: false })
  })

  it('rounds both times to whole ms first, so the gap equals the printed difference', () => {
    // A pace ghost's scaled split is fractional: 5646.4 prints 0:05.646, and 11940 − 5646 = 6.294.
    expect(tagText('author', 5_646.4, 11_939.99, [11_939.99, 5_646.4]).detail).toBe('1st 0:05.646 +6.294')
  })

  it('places the ghost 2nd behind a faster car', () => {
    expect(tagText('pb', 12_345, 12_000, [12_000, 12_345]).detail).toBe('2nd 0:12.345 -0.345')
  })
})

describe('ghost selection', () => {
  it('parses ?ghosts= and keeps the stored choice when it names nothing known', () => {
    expect(ghostsFromQuery('author,pb')).toEqual(['pb', 'author'])
    expect(ghostsFromQuery('none')).toEqual([])
    expect(ghostsFromQuery('bogus')).toBeNull()
    expect(ghostsFromQuery('')).toBeNull()
    expect(ghostsFromQuery(null)).toBeNull()
    expect(ghostsQuery([])).toBe('none')
    expect(ghostsQuery(['pb', 'gold'])).toBe('pb,gold')
  })

  it('offers medal ghosts only in a single-lap race on a medal track whose pace lap finished', () => {
    const all = ['pb', 'gold', 'author'] as const
    expect(offeredGhosts(all, { medals: true, laps: 1, paceLap: true })).toEqual(['pb', 'gold', 'author'])
    expect(offeredGhosts(all, { medals: false, laps: 1, paceLap: true })).toEqual(['pb'])
    expect(offeredGhosts(all, { medals: true, laps: 2, paceLap: true })).toEqual(['pb'])
    expect(offeredGhosts(all, { medals: true, laps: 1, paceLap: false })).toEqual(['pb'])
    expect(offeredGhosts([], { medals: true, laps: 1, paceLap: true })).toEqual([])
  })
})

describe('ghost time at the point the car last passed', () => {
  it('reads checkpoints 1..n, then the finish as point n+1', () => {
    expect(timeAtPoint([5_000, 9_000], 14_000, 0, 2)).toBeNull()
    expect(timeAtPoint([5_000, 9_000], 14_000, 1, 2)).toBe(5_000)
    expect(timeAtPoint([5_000, 9_000], 14_000, 2, 2)).toBe(9_000)
    expect(timeAtPoint([5_000, 9_000], 14_000, 3, 2)).toBe(14_000)
    // A ghost kept without splits has only its finish.
    expect(timeAtPoint([], 14_000, 1, 2)).toBeNull()
    expect(timeAtPoint([], 14_000, 3, 2)).toBe(14_000)
  })
})
