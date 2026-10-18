import { describe, expect, it } from 'vitest'
import { DEFAULT_LIVERY } from '../render/car/livery'
import { TIME_CHOICES, WEATHER_CHOICES } from '../track/environment'
import { DEFAULT_SETTINGS, effectiveFxQuery, HUD_SCALES, loadSettings, saveSettings } from './settings'

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
    saveSettings(s, { volume: 0.3, sfxVolume: 0.4, uiVolume: 0.5, fx: ['bloom', 'skid'], laps: 3, time: 'night', weather: 'rain', livery: { pattern: 'checker' as const, paint: 'teal' as const, number: 42 }, reflections: true, aa: true, hudScale: 1.15, records: 'open' as const, frameCap: 30 })
    expect(loadSettings(s)).toEqual({ volume: 0.3, sfxVolume: 0.4, uiVolume: 0.5, fx: ['bloom', 'skid'], laps: 3, time: 'night', weather: 'rain', livery: { pattern: 'checker' as const, paint: 'teal' as const, number: 42 }, reflections: true, aa: true, hudScale: 1.15, records: 'open' as const, frameCap: 30 })
    s.setItem('driftline-settings', JSON.stringify({ volume: 5, sfxVolume: -2, uiVolume: 'loud', fx: ['bloom', 'x'], laps: 0, time: 'dawn', weather: 'hail', reflections: 'yes', aa: 'no', hudScale: 7, records: 'sideways', frameCap: 45 }))
    expect(loadSettings(s)).toEqual({ volume: 1, sfxVolume: 0, uiVolume: 1, fx: ['bloom'], laps: 1, time: 'default', weather: 'default', livery: DEFAULT_LIVERY, reflections: false, aa: false, hudScale: 1, records: 'auto', frameCap: 0 })
  })
  it('keeps every time and weather choice across a reload', () => {
    const s = fake()
    for (const time of TIME_CHOICES) {
      saveSettings(s, { ...DEFAULT_SETTINGS, time })
      expect(loadSettings(s).time).toBe(time)
    }
    for (const weather of WEATHER_CHOICES) {
      saveSettings(s, { ...DEFAULT_SETTINGS, weather })
      expect(loadSettings(s).weather).toBe(weather)
    }
  })
  it('reads the legacy one-setting environment mode as both fields', () => {
    const s = fake()
    s.setItem('driftline-settings', JSON.stringify({ environment: 'random' }))
    expect(loadSettings(s)).toMatchObject({ time: 'random', weather: 'random' })
    s.setItem('driftline-settings', JSON.stringify({ environment: 'fixed' }))
    expect(loadSettings(s)).toMatchObject({ time: 'default', weather: 'default' })
    // A saved Time/Weather pick wins over a stale legacy key.
    s.setItem('driftline-settings', JSON.stringify({ environment: 'random', time: 'noon', weather: 'cloudy' }))
    expect(loadSettings(s)).toMatchObject({ time: 'noon', weather: 'cloudy' })
  })
  it('keeps the livery across a reload and repairs a bad one', () => {
    const s = fake()
    saveSettings(s, { ...DEFAULT_SETTINGS, livery: { pattern: 'flag', paint: 'purple', number: 99 } })
    expect(loadSettings(s).livery).toEqual({ pattern: 'flag', paint: 'purple', number: 99 })
    s.setItem('driftline-settings', JSON.stringify({ livery: { pattern: 'plaid', paint: 'gold', number: 300 } }))
    expect(loadSettings(s).livery).toEqual({ pattern: DEFAULT_LIVERY.pattern, paint: DEFAULT_LIVERY.paint, number: 99 })
  })
  it('keeps every HUD scale across a reload and repairs a bad one', () => {
    const s = fake()
    for (const hudScale of HUD_SCALES) {
      saveSettings(s, { ...DEFAULT_SETTINGS, hudScale })
      expect(loadSettings(s).hudScale).toBe(hudScale)
    }
    s.setItem('driftline-settings', JSON.stringify({ hudScale: '1.3' }))
    expect(loadSettings(s).hudScale).toBe(1)
  })
  it('url fx wins over saved fx', () => {
    expect(effectiveFxQuery('?fx=skid', { ...DEFAULT_SETTINGS, fx: ['bloom'] })).toBe('?fx=skid')
    expect(effectiveFxQuery('', { ...DEFAULT_SETTINGS, fx: ['bloom', 'skid'] })).toBe('?fx=bloom%2Cskid')
  })
})
