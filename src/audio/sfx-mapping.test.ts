import { describe, expect, it } from 'vitest'
import {
  busGain, engineFreq, IMPACT_FLOOR, IMPACT_MAX_GAIN, impactGain, KERB_MAX_GAIN, kerbGain, SKID_SLIP_DEG, SQUEAL_MAX_GAIN, squealFreq,
  squealGain, squeals, UI_MAX_GAIN, UI_SHOTS,
} from './mapping'

const kmh = (v: number) => v / 3.6

describe('squealGain', () => {
  it('is 0 at or below the skid threshold and when slow or reversing', () => {
    for (const slip of [0, 5, 10, SKID_SLIP_DEG]) expect(squealGain(slip, 20)).toBe(0)
    expect(squealGain(40, 4)).toBe(0)
    expect(squealGain(178, 20)).toBe(0)
  })
  it('rises strictly with slip above the threshold up to its max', () => {
    let prev = 0
    for (let slip = SKID_SLIP_DEG + 2; slip <= SKID_SLIP_DEG + 30; slip += 2) {
      const g = squealGain(slip, 20)
      expect(g).toBeGreaterThan(prev)
      prev = g
    }
    expect(squealGain(90, 20)).toBe(SQUEAL_MAX_GAIN)
  })
  it('pitches up with slip', () => {
    expect(squealFreq(40)).toBeGreaterThan(squealFreq(20))
  })
  it('squeals on road, not on loose ground or ice', () => {
    for (const m of ['road', 'turbo', 'cruise'] as const) expect(squeals(m)).toBe(true)
    for (const m of ['dirt', 'grass', 'ice', 'offroad'] as const) expect(squeals(m)).toBe(false)
  })
})

describe('impactGain', () => {
  it('is silent under the floor (braking, bumps) and rises with the hit', () => {
    expect(impactGain(0)).toBe(0)
    expect(impactGain(IMPACT_FLOOR)).toBe(0)
    expect(impactGain(5)).toBeGreaterThan(0)
    expect(impactGain(10)).toBeGreaterThan(impactGain(5))
    expect(impactGain(100)).toBe(IMPACT_MAX_GAIN)
  })
})

describe('kerbGain', () => {
  it('is 0 off the kerb or at a crawl, and louder with speed on it', () => {
    expect(kerbGain(false, 30)).toBe(0)
    expect(kerbGain(true, 1)).toBe(0)
    expect(kerbGain(true, 30)).toBeGreaterThan(kerbGain(true, 10))
    expect(kerbGain(true, 1000)).toBeLessThanOrEqual(KERB_MAX_GAIN)
  })
})

describe('engine pitch follows speed', () => {
  it('80 km/h pitches higher than 20 km/h at equal throttle', () => {
    for (const throttle of [0, 0.5, 1]) expect(engineFreq(kmh(80), throttle)).toBeGreaterThan(engineFreq(kmh(20), throttle))
  })
})

describe('busGain', () => {
  it('is 0 at slider 0, the slider value in 0..1, clamped outside', () => {
    expect(busGain(0)).toBe(0)
    expect(busGain(0.4)).toBe(0.4)
    expect(busGain(2)).toBe(1)
    expect(busGain(-1)).toBe(0)
  })
})

describe('UI sounds', () => {
  it('stay restrained: every peak gain is at most UI_MAX_GAIN and each lasts under 0.1 s per note', () => {
    for (const shot of Object.values(UI_SHOTS)) {
      expect(shot.gain).toBeLessThanOrEqual(UI_MAX_GAIN)
      expect(shot.duration).toBeLessThan(0.1)
    }
  })
})
