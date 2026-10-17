import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { liveFx, settingsChange } from './live'

const base: Settings = { ...DEFAULT_SETTINGS }

describe('settingsChange', () => {
  it('reports nothing for an unchanged value', () => {
    expect(settingsChange(base, { ...base })).toEqual({})
  })
  it('names each changed part, and only that part', () => {
    expect(settingsChange(base, { ...base, livery: { ...base.livery, paint: 'red' } })).toEqual({ livery: { ...base.livery, paint: 'red' } })
    expect(settingsChange(base, { ...base, livery: { ...base.livery, number: 12 } })).toEqual({ livery: { ...base.livery, number: 12 } })
    expect(settingsChange(base, { ...base, livery: { ...base.livery, pattern: 'checker' } })).toEqual({ livery: { ...base.livery, pattern: 'checker' } })
    expect(settingsChange(base, { ...base, reflections: !base.reflections })).toEqual({ reflections: !base.reflections })
    expect(settingsChange(base, { ...base, time: 'night' })).toEqual({ environment: true })
    expect(settingsChange(base, { ...base, weather: 'rain' })).toEqual({ environment: true })
    expect(settingsChange(base, { ...base, laps: 3 })).toEqual({ laps: 3 })
    expect(settingsChange(base, { ...base, volume: 0.2 })).toEqual({ volume: 0.2 })
    expect(settingsChange(base, { ...base, sfxVolume: 0.3 })).toEqual({ sfxVolume: 0.3 })
    expect(settingsChange(base, { ...base, uiVolume: 0 })).toEqual({ uiVolume: 0 })
    expect(settingsChange(base, { ...base, fx: ['smoke'] })).toEqual({ fx: new Set(['smoke']) })
  })
  it('ignores the always-on effects, which no toggle changes', () => {
    expect(settingsChange(base, { ...base, fx: ['bloom', 'skid'] })).toEqual({})
    expect(liveFx({ fx: ['bloom', 'speedlines', 'skid', 'smoke'] })).toEqual(new Set(['speedlines', 'smoke']))
  })
})
