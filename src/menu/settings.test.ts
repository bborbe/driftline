import { describe, expect, it } from 'vitest'
import { DEFAULT_LIVERY } from '../render/car/livery'
import { TIME_CHOICES, WEATHER_CHOICES } from '../track/environment'
import { DEFAULT_SETTINGS, effectiveFxQuery, HUD_SCALES, loadSettings, reducedEffectsOn, saveSettings, type Settings } from './settings'
import { qualityKnobs } from '../render/quality'

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
    const knobs = { pixelRatio: 1.5, shadows: 1024 as const, post: true, reflections: false, aa: true, particles: 0.25 }
    const saved = { volume: 0.3, sfxVolume: 0.4, uiVolume: 0.5, fx: ['bloom', 'skid'] as Settings['fx'], laps: 3, time: 'night' as const, weather: 'rain' as const, livery: { pattern: 'checker' as const, paint: 'teal' as const, number: 42 }, quality: 'custom' as const, knobs, hudScale: 1.15, colourSafe: true, reducedEffects: false, records: 'closed' as const, frameCap: 30, ghosts: ['author'] as Settings['ghosts'] }
    saveSettings(s, saved)
    expect(loadSettings(s)).toEqual(saved)
    s.setItem('driftline-settings', JSON.stringify({ volume: 5, sfxVolume: -2, uiVolume: 'loud', fx: ['bloom', 'x'], laps: 0, time: 'dawn', weather: 'hail', quality: 'ultra', knobs: { pixelRatio: 9, shadows: 512, post: 'yes', particles: 2 }, hudScale: 7, records: 'sideways', colourSafe: 'yes', reducedEffects: 'no', frameCap: 45, ghosts: 'all' }))
    expect(loadSettings(s)).toEqual({ ...DEFAULT_SETTINGS, volume: 1, sfxVolume: 0, uiVolume: 1, fx: ['bloom'], laps: 1, time: 'default', weather: 'default', livery: DEFAULT_LIVERY })
  })
  it('reads a save from before the presets: FXAA on is Custom on top of High, otherwise High', () => {
    const s = fake()
    s.setItem('driftline-settings', JSON.stringify({ volume: 0.5, reflections: true, aa: true }))
    expect(loadSettings(s)).toMatchObject({ quality: 'custom', knobs: { ...qualityKnobs('high'), aa: true, reflections: true } })
    s.setItem('driftline-settings', JSON.stringify({ volume: 0.5, reflections: false, aa: false }))
    expect(loadSettings(s)).toMatchObject({ quality: 'high', knobs: qualityKnobs('high') })
  })
  it('follows the system reduce-motion until the player chooses', () => {
    expect(reducedEffectsOn({ reducedEffects: null }, true)).toBe(true)
    expect(reducedEffectsOn({ reducedEffects: null }, false)).toBe(false)
    expect(reducedEffectsOn({ reducedEffects: false }, true)).toBe(false)
    expect(reducedEffectsOn({ reducedEffects: true }, false)).toBe(true)
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
