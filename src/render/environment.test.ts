import { describe, expect, it } from 'vitest'
import { TIMES, WEATHERS } from '../track/environment'
import { cloudPixels, environmentLook, mixColour, TIME_LOOKS } from './environment'
import { DEFAULT_THEME, resolveTheme, SKY_BRIGHTNESS } from './theme'
import { loadLap } from '../track/registry'
import { isColour } from '../track/schema'

const noonSunny = { time: 'noon', weather: 'sunny' } as const

describe('environmentLook', () => {
  it("keeps the track's own lighting for its default preset (today's look)", () => {
    const theme = resolveTheme(loadLap('leap'))
    const look = environmentLook(theme, { time: 'night', weather: 'sunny' }, { time: 'night', weather: 'sunny' })
    expect(look).toMatchObject({ sky: theme.sky, skyBrightness: SKY_BRIGHTNESS[theme.sky], skyLight: theme.skyLight, exposure: theme.exposure, fog: theme.fog, sun: theme.sun, sunIntensity: theme.sunIntensity })
    expect(look.night).toBe(true)
  })

  it('noon sunny on the default theme is the stadium look it had before presets, sun offset included', () => {
    const look = environmentLook(DEFAULT_THEME, noonSunny, noonSunny)
    expect(look).toEqual({
      sky: 'day',
      skyBrightness: 1,
      skyLight: DEFAULT_THEME.skyLight,
      exposure: 1,
      fog: DEFAULT_THEME.fog,
      fogNear: DEFAULT_THEME.fogNear,
      fogFar: DEFAULT_THEME.fogFar,
      sun: DEFAULT_THEME.sun,
      sunIntensity: DEFAULT_THEME.sunIntensity,
      sunOffset: [40, 80, 30],
      clouds: null,
      night: false,
      rain: false,
    })
  })

  it('gives all 16 presets valid, distinct lighting', () => {
    const seen = new Set<string>()
    for (const time of TIMES)
      for (const weather of WEATHERS) {
        const l = environmentLook(DEFAULT_THEME, { time, weather }, noonSunny)
        expect(isColour(l.fog) && isColour(l.sun), `${time} ${weather}`).toBe(true)
        expect(l.fogNear).toBeLessThan(l.fogFar)
        for (const v of [l.skyBrightness, l.skyLight, l.exposure, l.sunIntensity]) expect(v).toBeGreaterThan(0)
        seen.add(JSON.stringify(l))
      }
    expect(seen.size).toBe(16)
  })

  it('low sun at morning and sunset casts longer shadows than noon', () => {
    const elevation = ([x, y, z]: number[]) => Math.atan2(y, Math.hypot(x, z))
    expect(elevation(TIME_LOOKS.morning.sunOffset)).toBeLessThan(elevation(TIME_LOOKS.noon.sunOffset))
    expect(elevation(TIME_LOOKS.sunset.sunOffset)).toBeLessThan(elevation(TIME_LOOKS.morning.sunOffset))
  })

  it('weather dims the sun and pulls the haze in, rain most', () => {
    const at = (weather: (typeof WEATHERS)[number]) => environmentLook(DEFAULT_THEME, { time: 'noon', weather }, { time: 'night', weather: 'sunny' })
    const [sunny, cloudy, overcast, rain] = WEATHERS.map(at)
    expect(cloudy.sunIntensity).toBeLessThan(sunny.sunIntensity)
    expect(overcast.sunIntensity).toBeLessThan(cloudy.sunIntensity)
    expect(rain.sunIntensity).toBeLessThan(overcast.sunIntensity)
    expect(rain.fogFar).toBeLessThan(overcast.fogFar)
    expect(sunny.clouds).toBeNull()
    expect(cloudy.clouds!.cover).toBeLessThan(overcast.clouds!.cover)
    expect(overcast.sky).toBe('overcast')
    expect([sunny.rain, cloudy.rain, overcast.rain, rain.rain]).toEqual([false, false, false, true])
  })

  it('switches the night extras on only at night', () => {
    for (const time of TIMES) expect(environmentLook(DEFAULT_THEME, { time, weather: 'sunny' }, noonSunny).night).toBe(time === 'night')
  })
})

describe('mixColour', () => {
  it('blends sRGB channels', () => {
    expect(mixColour('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixColour('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixColour('#000000', '#ff8000', 0.5)).toBe('#804000')
  })
})

describe('cloudPixels', () => {
  const W = 64
  const H = 16
  const alpha = (p: Uint8ClampedArray) => Array.from({ length: p.length / 4 }, (_, i) => p[i * 4 + 3])
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length

  it('is clear at cover 0', () => {
    expect(alpha(cloudPixels(W, H, 0, 1)).every((a) => a === 0)).toBe(true)
  })

  it('covers more of the sky as cover rises', () => {
    const [few, many, solid] = [0.3, 0.6, 1].map((c) => mean(alpha(cloudPixels(W, H, c, 1))))
    expect(few).toBeGreaterThan(0)
    expect(many).toBeGreaterThan(few)
    expect(solid).toBeGreaterThan(many)
    expect(solid).toBeGreaterThan(200)
  })

  it('is seeded: the same seed draws the same sky, another seed a different one', () => {
    expect(cloudPixels(W, H, 0.5, 3)).toEqual(cloudPixels(W, H, 0.5, 3))
    expect(cloudPixels(W, H, 0.5, 3)).not.toEqual(cloudPixels(W, H, 0.5, 4))
  })

  it('wraps around the sky with no seam: the last column continues into the first', () => {
    const p = cloudPixels(256, H, 0.5, 9)
    const a = (i: number, j: number) => p[(j * 256 + i) * 4 + 3]
    for (let j = 0; j < H - 2; j++) expect(Math.abs(a(255, j) - a(0, j))).toBeLessThan(40)
  })

  it('fades out at the horizon row', () => {
    const a = alpha(cloudPixels(W, 64, 1, 1))
    expect(Math.max(...a.slice(63 * W))).toBeLessThan(40)
  })
})
