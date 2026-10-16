import { describe, expect, it } from 'vitest'
import { chaseTarget, debugVisible, kmh, litTicks, SPEEDO_MAX_KMH, SPEEDO_TICKS } from './hud'

const medals = { author: 40000, gold: 45000, silver: 52000, bronze: 60000 }

describe('kmh', () => {
  it('converts forward m/s to whole km/h', () => {
    expect(kmh(10)).toBe(36)
    expect(kmh(27.8)).toBe(100)
  })

  it('reads reversing as a positive speed', () => {
    expect(kmh(-5)).toBe(18)
  })
})

describe('litTicks', () => {
  it('lights none at rest and all at the top speed', () => {
    expect(litTicks(0)).toBe(0)
    expect(litTicks(SPEEDO_MAX_KMH)).toBe(SPEEDO_TICKS)
  })

  it('scales linearly and clamps past the top', () => {
    expect(litTicks(SPEEDO_MAX_KMH / 2)).toBe(SPEEDO_TICKS / 2)
    expect(litTicks(SPEEDO_MAX_KMH * 2)).toBe(SPEEDO_TICKS)
    expect(litTicks(-10)).toBe(0)
  })
})

describe('chaseTarget', () => {
  it('chases bronze before any medal is earned', () => {
    expect(chaseTarget(medals, null, null)).toEqual({ label: 'BRONZE', ms: 60000, medal: 'bronze' })
  })

  it('chases the medal above the best one earned', () => {
    expect(chaseTarget(medals, 'silver', 50000)).toEqual({ label: 'GOLD', ms: 45000, medal: 'gold' })
  })

  it('chases the personal best once author is earned', () => {
    expect(chaseTarget(medals, 'author', 39000)).toEqual({ label: 'BEST', ms: 39000, medal: null })
  })

  it('chases the personal best on a track without medals, nothing before the first lap', () => {
    expect(chaseTarget(undefined, null, 51590)).toEqual({ label: 'BEST', ms: 51590, medal: null })
    expect(chaseTarget(undefined, null, null)).toBeNull()
  })
})

describe('debugVisible', () => {
  it('is on by default and off with ?debug=0', () => {
    expect(debugVisible('')).toBe(true)
    expect(debugVisible('?track=lap2&debug=1')).toBe(true)
    expect(debugVisible('?track=lap2&debug=0')).toBe(false)
  })
})
