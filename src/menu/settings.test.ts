import { describe, expect, it } from 'vitest'
import { DEFAULT_LIVERY } from '../render/car/livery'
import { DEFAULT_SETTINGS, effectiveFxQuery, loadSettings, saveSettings } from './settings'

const fake = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('settings', () => {
  it('defaults when nothing is stored or the value is garbage', () => {
    const s = fake()
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS)
    s.setItem('driftline-settings', '{nope')
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS)
  })
  it('round-trips and drops unknown effects', () => {
    const s = fake()
    saveSettings(s, { volume: 0.3, fx: ['bloom', 'skid'], laps: 3, environment: 'random', livery: { pattern: 'checker' as const, paint: 'teal' as const, number: 42 } })
    expect(loadSettings(s)).toEqual({ volume: 0.3, fx: ['bloom', 'skid'], laps: 3, environment: 'random', livery: { pattern: 'checker' as const, paint: 'teal' as const, number: 42 } })
    s.setItem('driftline-settings', JSON.stringify({ volume: 5, fx: ['bloom', 'x'], laps: 0, environment: 'stormy' }))
    expect(loadSettings(s)).toEqual({ volume: 1, fx: ['bloom'], laps: 1, environment: 'fixed', livery: DEFAULT_LIVERY })
  })
  it('keeps the livery across a reload and repairs a bad one', () => {
    const s = fake()
    saveSettings(s, { ...DEFAULT_SETTINGS, livery: { pattern: 'flag', paint: 'purple', number: 99 } })
    expect(loadSettings(s).livery).toEqual({ pattern: 'flag', paint: 'purple', number: 99 })
    s.setItem('driftline-settings', JSON.stringify({ livery: { pattern: 'plaid', paint: 'gold', number: 300 } }))
    expect(loadSettings(s).livery).toEqual({ pattern: DEFAULT_LIVERY.pattern, paint: DEFAULT_LIVERY.paint, number: 99 })
  })
  it('url fx wins over saved fx', () => {
    expect(effectiveFxQuery('?fx=skid', { volume: 1, fx: ['bloom'], laps: 1, environment: 'fixed', livery: DEFAULT_LIVERY })).toBe('?fx=skid')
    expect(effectiveFxQuery('', { volume: 1, fx: ['bloom', 'skid'], laps: 1, environment: 'fixed', livery: DEFAULT_LIVERY })).toBe('?fx=bloom%2Cskid')
  })
})
