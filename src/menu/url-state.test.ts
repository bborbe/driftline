import { describe, expect, it } from 'vitest'
import { v3 } from '../physics/vec'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { screenQuery, settingsFromUrl, stateQuery, viewFromUrl, type UrlState } from './url-state'
import { qualityKnobs } from '../render/quality'

const custom: Settings = {
  volume: 0.25,
  // Not in the URL, so the defaults a fresh tab would load.
  sfxVolume: 1,
  uiVolume: 1,
  fx: ['speedlines'],
  laps: 3,
  time: 'night',
  weather: 'snow',
  livery: { pattern: 'checker', paint: 'teal', number: 42 },
  hudScale: 1.15,
  // Custom: only the two knobs a link carries differ from the stored (High) ones.
  quality: 'custom',
  knobs: { ...qualityKnobs('high'), reflections: false, aa: true },
  // Not in the URL either.
  colourSafe: false,
  reducedEffects: null,
  records: 'closed',
  frameCap: 30,
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
    expect(one('hud', '0.75').hudScale).toBe(0.75)
    expect(one('hud', '2').hudScale).toBe(1)
    expect(new URLSearchParams(q).get('quality')).toBe('custom')
    expect(new URLSearchParams(q).get('refl')).toBe('0')
    expect(new URLSearchParams(q).get('aa')).toBe('1')
    expect(one('rec', 'open').records).toBe('open')
    expect(one('rec', 'wide').records).toBe('auto')
    expect(new URLSearchParams(q).get('rec')).toBe('closed')
    expect(one('fps', '60').frameCap).toBe(60)
    expect(one('fps', '0').frameCap).toBe(0)
    expect(one('fps', '45').frameCap).toBe(0)
    expect(settingsFromUrl('?fps=0', custom).frameCap).toBe(0)
    expect(new URLSearchParams(q).get('fps')).toBe('30')
  })
  it('names the quality, and a knob a link sets that differs from it makes it Custom', () => {
    const one = (k: string, v: string) => settingsFromUrl(`?${k}=${v}`, DEFAULT_SETTINGS)
    expect(one('quality', 'low')).toMatchObject({ quality: 'low', knobs: qualityKnobs('low') })
    expect(one('quality', 'medium').knobs).toEqual(qualityKnobs('medium'))
    expect(one('quality', 'auto').quality).toBe('auto')
    expect(one('quality', 'ultra').quality).toBe(DEFAULT_SETTINGS.quality)
    // High already has reflections on, so ?refl=1 keeps it High; ?refl=0 or ?aa=1 is a Custom setup.
    expect(one('refl', '1').quality).toBe('high')
    expect(one('refl', '0')).toMatchObject({ quality: 'custom', knobs: { ...qualityKnobs('high'), reflections: false } })
    expect(one('aa', '1')).toMatchObject({ quality: 'custom', knobs: { ...qualityKnobs('high'), aa: true } })
    expect(settingsFromUrl('?quality=low&refl=1', DEFAULT_SETTINGS)).toMatchObject({ quality: 'custom', knobs: { ...qualityKnobs('low'), reflections: true } })
    expect(settingsFromUrl('?aa=0', custom).knobs.aa).toBe(false)
  })
  it('writes the knobs only for Custom: a preset or Auto names them itself', () => {
    const low = new URLSearchParams(stateQuery('?refl=1&aa=1', race({ ...DEFAULT_SETTINGS, quality: 'low', knobs: qualityKnobs('low') })))
    expect(low.get('quality')).toBe('low')
    expect(low.has('refl')).toBe(false)
    expect(low.has('aa')).toBe(false)
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
    const q = '?time=dusk&weather=hail&laps=x&vol=loud&pattern=plaid&paint=gold&num=0&view=drone&refl=maybe&aa=maybe'
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
  it('leaves a seed link to name its own environment', () => {
    const q = new URLSearchParams(stateQuery('?track=test1&seed=12', race(custom)))
    expect([q.get('seed'), q.has('time'), q.has('weather')]).toEqual(['12', false, false])
  })
  it('mirrors orbit while flying', () => {
    const fly = { position: v3(), velocity: v3(), yaw: 0, pitch: 0 }
    expect(new URLSearchParams(stateQuery('', race(custom, { fly, orbiting: true }))).get('orbit')).toBe('1')
    expect(new URLSearchParams(stateQuery('?orbit=1&cam=fly', race(custom, { fly, orbiting: false }))).has('orbit')).toBe(false)
  })
  it('leaving fly puts back the car spawn or top camera the page booted with', () => {
    const fly = { position: v3(1, 2, 3), velocity: v3(), yaw: 0, pitch: 0 }
    const spawn = '?track=test1&x=1&y=2&z=3&yaw=90&freeze=1'
    const flying = stateQuery(spawn, race(custom, { fly, boot: spawn }))
    const back = new URLSearchParams(stateQuery(flying, race(custom, { boot: spawn })))
    expect(['x', 'y', 'z', 'yaw', 'freeze', 'cam', 'pitch'].map((k) => back.get(k))).toEqual(['1', '2', '3', '90', '1', null, null])
    const top = '?track=test1&cam=top'
    const fromTop = new URLSearchParams(stateQuery(stateQuery(top, race(custom, { fly, boot: top })), race(custom, { boot: top })))
    expect([fromTop.get('cam'), fromTop.has('x')]).toEqual(['top', false])
  })
  it('Back to menu and Next track keep the settings and drop every spawn and camera link', () => {
    const search = '?track=glacier&x=1&y=2&z=3&yaw=0&pitch=0&cam=fly&freeze=1&orbit=1&debug=0'
    const menu = new URLSearchParams(screenQuery(search, race(custom), { sel: 'glacier' }))
    expect(settingsFromUrl(`?${menu}`, DEFAULT_SETTINGS)).toEqual(custom)
    expect([menu.get('sel'), menu.has('track'), menu.get('debug')]).toEqual(['glacier', false, '0'])
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'cam', 'freeze', 'orbit']) expect(menu.has(k)).toBe(false)
    expect(new URLSearchParams(screenQuery(search, race(custom), { track: 'dustbowl' })).get('track')).toBe('dustbowl')
  })
})
