import { describe, expect, it } from 'vitest'
import { LAP_NAMES, lapName } from './registry'

describe('shipped tracks', () => {
  it('lists the multi-level campaign tracks, never the piece catalogue', () => {
    expect(LAP_NAMES).toContain('crossover')
    expect(LAP_NAMES).toContain('tower')
    expect(LAP_NAMES).not.toContain('pieces')
  })
  it('resolves ?track= to a named track, the piece catalogue to the default', () => {
    expect(lapName('?track=crossover')).toBe('crossover')
    expect(lapName('?track=pieces')).toBe('test1')
  })
})
