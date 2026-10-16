import { describe, expect, it } from 'vitest'
import { LAP_NAMES, lapName, sortLaps } from './lap'

describe('shipped laps', () => {
  it('lists the lapN test laps first, then the named tracks, and never the piece catalogue', () => {
    expect(LAP_NAMES).toEqual(['lap1', 'lap2', 'crossover', 'tower'])
    expect(sortLaps(['tower', 'lap10', 'crossover', 'lap2'])).toEqual(['lap2', 'lap10', 'crossover', 'tower'])
  })
  it('resolves ?track= to a named track, unknown names to lap1', () => {
    expect(lapName('?track=crossover')).toBe('crossover')
    expect(lapName('?track=pieces')).toBe('lap1')
  })
})
