import { describe, expect, it } from 'vitest'
import { v3 } from '../physics/vec'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { settingsFromUrl, stateQuery, viewFromUrl, type UrlState } from './url-state'

const custom: Settings = {
  volume: 0.25,
  fx: ['speedlines'],
  laps: 3,
  time: 'night',
  weather: 'snow',
  livery: { pattern: 'checker', paint: 'teal', number: 42 },
}
const race = (settings: Settings, extra: Partial<UrlState> = {}): UrlState => ({ settings, view: 'far', screen: { track: 'glacier' }, fly: null, ...extra })

describe('url state', () => {
  it('round-trips every setting, the view and the track through the query', () => {
    const q = stateQuery('', race(custom))
    expect(settingsFromUrl(q, DEFAULT_SETTINGS)).toEqual(custom)
    expect(viewFromUrl(q, 'close')).toBe('far')
    expect(new URLSearchParams(q).get('track')).toBe('glacier')
    // Each key on its own reaches its field.
    const one = (k: string, v: string) => settingsFromUrl(`?${k}=${v}`, DEFAULT_SETTINGS)
    expect(one('time', 'sunset').time).toBe('sunset')
    expect(one('weather', 'rain').weather).toBe('rain')
    expect(one('laps', '5').laps).toBe(5)
    expect(one('fx', 'smoke').fx).toEqual(['smoke'])
    expect(one('vol', '0.4').volume).toBe(0.4)
    expect(one('pattern', 'flag').livery.pattern).toBe('flag')
    expect(one('paint', 'pink').livery.paint).toBe('pink')
    expect(one('num', '13').livery.number).toBe(13)
  })
  it('keeps random and default choices, and no effects', () => {
    const s = { ...DEFAULT_SETTINGS, time: 'random' as const, weather: 'default' as const, fx: [] }
    expect(settingsFromUrl(stateQuery('', race(s)), custom)).toEqual(s)
  })
  it('URL beats storage, storage beats defaults, a bare URL changes nothing', () => {
    expect(settingsFromUrl('?time=noon&num=8', custom)).toEqual({ ...custom, time: 'noon', livery: { ...custom.livery, number: 8 } })
    expect(settingsFromUrl('', custom)).toEqual(custom)
    expect(settingsFromUrl('', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    expect(viewFromUrl('', 'cockpit')).toBe('cockpit')
  })
  it('ignores bad values and keeps the stored ones', () => {
    const q = '?time=dusk&weather=hail&laps=x&vol=loud&pattern=plaid&paint=gold&num=0&view=drone'
    expect(settingsFromUrl(q, custom)).toEqual(custom)
    expect(viewFromUrl(q, 'far')).toBe('far')
  })
  it('keeps unrelated parameters and adds no car pose in a race', () => {
    const q = new URLSearchParams(stateQuery('?debug=0&renderer=webgl2&seed=12', race(custom)))
    expect([q.get('debug'), q.get('renderer'), q.get('seed')]).toEqual(['0', 'webgl2', '12'])
    for (const k of ['x', 'y', 'z', 'yaw', 'cam']) expect(q.has(k)).toBe(false)
  })
  it('writes the fly pose while flying and drops it after', () => {
    const fly = { position: v3(12.34, 5, -7.5), velocity: v3(), yaw: Math.PI / 2, pitch: -Math.PI / 12 }
    const flying = new URLSearchParams(stateQuery('?track=glacier', race(custom, { fly })))
    expect(['x', 'y', 'z', 'yaw', 'pitch', 'cam'].map((k) => flying.get(k))).toEqual(['12.3', '5.0', '-7.5', '90.0', '-15.0', 'fly'])
    expect(flying.has('freeze')).toBe(false)
    const landed = new URLSearchParams(stateQuery(`?${flying}&freeze=1&orbit=1`, race(custom)))
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'cam', 'freeze', 'orbit']) expect(landed.has(k)).toBe(false)
    // Before the camera exists (boot) the fly link stays, so a reload in fly mode reaches the camera.
    const booting = new URLSearchParams(stateQuery(`?${flying}`, race(custom, { fly: undefined })))
    expect([booting.get('cam'), booting.get('z')]).toEqual(['fly', '-7.5'])
  })
  it('keeps a car debug spawn as it was', () => {
    const q = new URLSearchParams(stateQuery('?track=test1&x=1&y=2&z=3&yaw=90&freeze=1', race(custom)))
    expect(['x', 'yaw', 'freeze'].map((k) => q.get(k))).toEqual(['1', '90', '1'])
  })
  it('the menu screen carries the focused card and no track', () => {
    const menu = new URLSearchParams(stateQuery('?track=glacier', race(custom, { screen: { sel: 'dustbowl' } })))
    expect(menu.has('track')).toBe(false)
    expect(menu.get('sel')).toBe('dustbowl')
    const back = new URLSearchParams(stateQuery(`?${menu}`, race(custom)))
    expect([back.get('track'), back.has('sel')]).toEqual(['glacier', false])
    expect(new URLSearchParams(stateQuery('?sel=a', race(custom, { screen: { sel: null } }))).has('sel')).toBe(false)
  })
})
