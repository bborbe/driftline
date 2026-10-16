import { describe, expect, it } from 'vitest'
import { MAX_SPEED } from '../physics'
import { engineFreq, masterGain, ONE_SHOTS, skidGain, WIND_MAX_GAIN, windGain } from './mapping'

describe('engineFreq', () => {
  it('rises with speed', () => {
    expect(engineFreq(0, 0)).toBeLessThan(engineFreq(20, 0))
    expect(engineFreq(20, 0)).toBeLessThan(engineFreq(40, 0))
  })
  it('rises with throttle at equal speed', () => {
    expect(engineFreq(10, 1)).toBeGreaterThan(engineFreq(10, 0))
  })
  it('treats reverse speed by magnitude', () => {
    expect(engineFreq(-8, 0)).toBe(engineFreq(8, 0))
  })
})

describe('windGain', () => {
  it('is silent at rest and maximal at MAX_SPEED', () => {
    expect(windGain(0)).toBe(0)
    expect(windGain(MAX_SPEED)).toBe(WIND_MAX_GAIN)
  })
  it('strictly increases with speed', () => {
    let prev = windGain(0)
    for (let v = 2; v <= MAX_SPEED; v += 2) {
      const g = windGain(v)
      expect(g).toBeGreaterThan(prev)
      prev = g
    }
  })
})

describe('skidGain', () => {
  it('is 0 at or below 15° slip', () => {
    expect(skidGain(10, 20)).toBe(0)
    expect(skidGain(15, 20)).toBe(0)
  })
  it('is > 0 above 15° slip at speed > 5 m/s', () => {
    expect(skidGain(25, 20)).toBeGreaterThan(0)
  })
  it('is 0 at speed ≤ 5 m/s even with slip > 15°', () => {
    expect(skidGain(40, 5)).toBe(0)
    expect(skidGain(40, 2)).toBe(0)
  })
  it('is 0 when plainly reversing (slip near 180°)', () => {
    expect(skidGain(178, 8)).toBe(0)
  })
})

describe('masterGain', () => {
  it('is 0 when muted', () => {
    expect(masterGain(true, 0.8)).toBe(0)
  })
  it('equals the slider value when unmuted, monotone in 0..1', () => {
    expect(masterGain(false, 0.3)).toBe(0.3)
    expect(masterGain(false, 0.3)).toBeLessThan(masterGain(false, 0.7))
    expect(masterGain(false, 2)).toBe(1)
    expect(masterGain(false, -1)).toBe(0)
  })
})

describe('ONE_SHOTS', () => {
  it('no two events share a (frequency, duration) signature', () => {
    const sigs = Object.values(ONE_SHOTS).map((o) => `${o.freqs.join(',')}@${o.duration}`)
    expect(new Set(sigs).size).toBe(sigs.length)
  })
})
