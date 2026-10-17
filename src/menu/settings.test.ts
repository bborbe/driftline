import { describe, expect, it } from 'vitest'
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
    saveSettings(s, { volume: 0.3, fx: ['bloom', 'skid'], laps: 3, environment: 'random' })
    expect(loadSettings(s)).toEqual({ volume: 0.3, fx: ['bloom', 'skid'], laps: 3, environment: 'random' })
    s.setItem('driftline-settings', JSON.stringify({ volume: 5, fx: ['bloom', 'x'], laps: 0, environment: 'stormy' }))
    expect(loadSettings(s)).toEqual({ volume: 1, fx: ['bloom'], laps: 1, environment: 'fixed' })
  })
  it('url fx wins over saved fx', () => {
    expect(effectiveFxQuery('?fx=skid', { volume: 1, fx: ['bloom'], laps: 1, environment: 'fixed' })).toBe('?fx=skid')
    expect(effectiveFxQuery('', { volume: 1, fx: ['bloom', 'skid'], laps: 1, environment: 'fixed' })).toBe('?fx=bloom%2Cskid')
  })
})
