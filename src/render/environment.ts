// The look of each time-of-day × weather preset (src/track/environment.ts): sun direction, colour
// and intensity, sky dome and image light, fog, exposure, cloud cover, and the night, rain and
// snow extras scene.ts and view.ts add. Visual only: nothing here reaches physics.
//
// A track's own default preset keeps its theme's lighting exactly (theme.ts), so the default look
// of every track is the one it already had; any other preset swaps the theme's lighting for the
// preset's while keeping its ground, curb, sign, screen and scenery. Snow is the one exception:
// its white haze is applied over a track's own default too (glacier), since the haze is the snow. The cloud field is a pure,
// seeded, horizontally tiling value-noise texture, unit-tested like the planners.
import type { Environment, TimeOfDay, Weather } from '../track/environment'
import type { Sky } from '../track/schema'
import { DEFAULT_THEME, SKY_BRIGHTNESS, type ResolvedTheme } from './theme'

export type CloudLook = {
  /** 0 (clear) .. 1 (solid): how much of the sky the cloud layer covers. */
  cover: number
  /** sRGB tint of the cloud layer: white by day, warm at sunset, dark at night and in rain. */
  color: string
}

export type EnvironmentLook = {
  sky: Sky
  /** Background dome intensity (SKY_BRIGHTNESS scaled by the weather). */
  skyBrightness: number
  skyLight: number
  exposure: number
  fog: string
  fogNear: number
  fogFar: number
  sun: string
  sunIntensity: number
  /** Sun position relative to the car (scene.ts follow()): its direction sets the shadow length. */
  sunOffset: [number, number, number]
  /** Null when the sky is left as the HDRI shows it (sunny). */
  clouds: CloudLook | null
  /** Floodlights on the stadium light posts and a glowing road edge. */
  night: boolean
  /** Neon Night (render/neon/): neon tubes, skyline, sparks, pink rims, the road reflection and the neon bloom and grade. */
  neon: boolean
  /** Falling streaks around the camera and a wet road. */
  rain: boolean
  /** Drifting flakes around the camera (the haze is already in `fog`). */
  snow: boolean
}

/** Distance from the car to the sun (and the shadow camera); the noon offset is today's (40, 80, 30). */
const SUN_DISTANCE = 100

/** Sun offset for an elevation and an azimuth (radians; 0 = +z, toward +x positive). */
export const sunOffset = (elevation: number, azimuth: number): [number, number, number] => [
  SUN_DISTANCE * Math.cos(elevation) * Math.sin(azimuth),
  SUN_DISTANCE * Math.sin(elevation),
  SUN_DISTANCE * Math.cos(elevation) * Math.cos(azimuth),
]

type TimeLook = Omit<EnvironmentLook, 'clouds' | 'night' | 'neon' | 'rain' | 'snow'> & {
  /** How much daylight the weather's grey has to work with (fog and cloud tint). */
  daylight: number
  cloud: string
}

const deg = Math.PI / 180

/** Clear-sky lighting per time of day. Noon is the default stadium look (DEFAULT_THEME). */
export const TIME_LOOKS: Record<TimeOfDay, TimeLook> = {
  morning: {
    sky: 'day',
    skyBrightness: 0.75,
    skyLight: 0.4,
    exposure: 0.88,
    fog: '#d9d2c6',
    fogNear: 160,
    fogFar: 900,
    sun: '#ffcf9e',
    sunIntensity: 1.9,
    sunOffset: sunOffset(18 * deg, -120 * deg),
    daylight: 0.85,
    cloud: '#fff1e2',
  },
  noon: {
    sky: DEFAULT_THEME.sky,
    skyBrightness: SKY_BRIGHTNESS[DEFAULT_THEME.sky],
    skyLight: DEFAULT_THEME.skyLight,
    exposure: DEFAULT_THEME.exposure,
    fog: DEFAULT_THEME.fog,
    fogNear: DEFAULT_THEME.fogNear,
    fogFar: DEFAULT_THEME.fogFar,
    sun: DEFAULT_THEME.sun,
    sunIntensity: DEFAULT_THEME.sunIntensity,
    sunOffset: [40, 80, 30],
    daylight: 1,
    cloud: '#eef1f5', // a touch under white, so a layer reads against the HDRI's own white clouds
  },
  sunset: {
    sky: 'sunset',
    skyBrightness: SKY_BRIGHTNESS.sunset,
    skyLight: 0.4,
    exposure: 0.85,
    fog: '#e3a27c',
    fogNear: 150,
    fogFar: 850,
    sun: '#ff9450',
    sunIntensity: 1.9,
    sunOffset: sunOffset(9 * deg, 70 * deg),
    daylight: 0.7,
    cloud: '#ffc29a',
  },
  night: {
    sky: 'night',
    skyBrightness: SKY_BRIGHTNESS.night * 0.6,
    skyLight: 0.15,
    exposure: 0.85,
    fog: '#0b1228',
    fogNear: 120,
    fogFar: 800,
    // The key light at night is the stadium floodlights: cold white, high, so shadows stay short.
    sun: '#c9d8ff',
    sunIntensity: 1.1,
    sunOffset: sunOffset(55 * deg, 30 * deg),
    daylight: 0.18,
    cloud: '#2b3446',
  },
  // Neon Night: a black stadium sky with no city glow (the dome all but off), a deep purple haze, and a
  // dim violet key light; the track is lit by its own neon (render/neon/), so the floodlights stay off.
  neon: {
    sky: 'night',
    skyBrightness: SKY_BRIGHTNESS.night * 0.1,
    skyLight: 0.03,
    exposure: 0.85,
    fog: '#14052a',
    fogNear: 90,
    fogFar: 750,
    sun: '#b07cff',
    sunIntensity: 0.3,
    sunOffset: sunOffset(60 * deg, -40 * deg),
    daylight: 0.1,
    cloud: '#2a1238',
  },
}

type WeatherLook = {
  cover: number
  /** Sun intensity factor: clouds dim the direct light. */
  sun: number
  /** Dome intensity factor. */
  dome: number
  /** Image light factor: an overcast sky lights more evenly. */
  skyLight: number
  exposure: number
  /** Share of the weather grey mixed into the fog colour. */
  grey: number
  /** Fog distance factor: below 1 pulls the haze in. */
  fog: number
  /** Swap the morning / noon HDRI for the overcast one. */
  overcastSky: boolean
  /** Cloud tint factor. */
  shade: number
  /** Share of SNOW_HAZE mixed into the fog after the grey: snow's cold white haze. */
  white: number
}

export const WEATHER_LOOKS: Record<Weather, WeatherLook> = {
  sunny: { cover: 0, sun: 1, dome: 1, skyLight: 1, exposure: 1, grey: 0, fog: 1, overcastSky: false, shade: 1, white: 0 },
  cloudy: { cover: 0.5, sun: 0.65, dome: 0.9, skyLight: 1, exposure: 1, grey: 0.25, fog: 0.85, overcastSky: false, shade: 1, white: 0 },
  overcast: { cover: 0.85, sun: 0.3, dome: 0.8, skyLight: 1.15, exposure: 0.95, grey: 0.6, fog: 0.6, overcastSky: true, shade: 0.75, white: 0 },
  rain: { cover: 1, sun: 0.2, dome: 0.6, skyLight: 1.1, exposure: 0.9, grey: 0.75, fog: 0.4, overcastSky: true, shade: 0.5, white: 0 },
  // Snow: a bright, even sky (soft light, little shadow) and a cold white haze that stays further
  // out than rain's, so the road ahead reads at speed.
  snow: { cover: 0.95, sun: 0.35, dome: 0.9, skyLight: 1.25, exposure: 1, grey: 0.2, fog: 0.55, overcastSky: true, shade: 0.95, white: 0.7 },
}

/** The cold white snow mixes into the fog (scaled by daylight, so night snow stays dark). */
export const SNOW_HAZE = '#e6edf2'

/** The grey a cloudy sky turns the fog toward, before the time of day's daylight scales it. */
const WEATHER_GREY = '#9aa1a8'

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const hex = (c: number[]): string => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
/** `a` toward `b` by `t` (sRGB channels; good enough for fog and tints). */
export const mixColour = (a: string, b: string, t: number): string => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t))
const scaleColour = (a: string, k: number): string => hex(rgb(a).map((v) => v * k))

const same = (a: Environment, b: Environment) => a.time === b.time && a.weather === b.weather

/**
 * The look for `env` on a track whose resolved theme is `theme` and whose own default preset is
 * `trackDefault`: that default keeps the theme's lighting unchanged, every other preset is built
 * from TIME_LOOKS × WEATHER_LOOKS. Clouds, night and rain always follow `env`.
 */
export function environmentLook(theme: ResolvedTheme, env: Environment, trackDefault: Environment): EnvironmentLook {
  const t = TIME_LOOKS[env.time]
  const w = WEATHER_LOOKS[env.weather]
  const clouds = w.cover > 0 ? { cover: w.cover, color: scaleColour(t.cloud, w.shade) } : null
  const extras = { sunOffset: t.sunOffset, clouds, night: env.time === 'night', neon: env.time === 'neon', rain: env.weather === 'rain', snow: env.weather === 'snow' }
  const white = scaleColour(SNOW_HAZE, t.daylight)
  if (same(env, trackDefault)) {
    const { sky, skyLight, exposure, fog, fogNear, fogFar, sun, sunIntensity } = theme
    const look = { sky, skyBrightness: SKY_BRIGHTNESS[sky], skyLight, exposure, fog, fogNear, fogFar, sun, sunIntensity, ...extras }
    // The theme keeps its light; snow still pulls its white haze in over it.
    return w.white > 0 ? { ...look, fog: mixColour(fog, white, w.white), fogNear: fogNear * w.fog, fogFar: fogFar * w.fog } : look
  }
  const swap = w.overcastSky && (env.time === 'morning' || env.time === 'noon')
  const grey = scaleColour(WEATHER_GREY, t.daylight)
  return {
    sky: swap ? 'overcast' : t.sky,
    skyBrightness: (swap ? SKY_BRIGHTNESS.overcast * t.daylight : t.skyBrightness) * w.dome,
    skyLight: t.skyLight * w.skyLight,
    exposure: t.exposure * w.exposure,
    fog: mixColour(mixColour(t.fog, grey, w.grey), white, w.white),
    fogNear: t.fogNear * w.fog,
    fogFar: t.fogFar * w.fog,
    sun: t.sun,
    sunIntensity: t.sunIntensity * w.sun,
    ...extras,
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * RGBA pixels of the cloud layer's texture: `width` × `height`, row 0 at the zenith and the last
 * row at the horizon (the top half of a sphere, scene.ts). Value-noise fBm on a lattice that wraps
 * in x, so the layer has no seam around the sky; `cover` 0 is clear, 1 solid. Dense cloud is drawn
 * a little darker, so the layer has some body.
 */
export function cloudPixels(width: number, height: number, cover: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  if (cover <= 0) return out
  const hash = (x: number, y: number, o: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(o + 1, 2147483647) ^ Math.imul(seed, 1442695041)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const octaves = 5
  const noise = (u: number, v: number) => {
    let sum = 0
    let amp = 0.5
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      const cx = 8 << o // lattice cells around the sky: a whole number, so x wraps
      const cy = 3 << o
      const x = u * cx
      const y = v * cy
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = smoothstep(0, 1, x - x0)
      const fy = smoothstep(0, 1, y - y0)
      const at = (ix: number, iy: number) => hash(((ix % cx) + cx) % cx, iy, o)
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
      sum += (top + (bottom - top) * fy) * amp
      norm += amp
      amp *= 0.5
    }
    return sum / norm
  }
  // fBm bunches around 0.5; stretch it to about 0..1 so `1 - cover` is roughly the clear share of the sky.
  const threshold = 1 - Math.min(1, cover)
  const floor = smoothstep(0.8, 1, cover) * 0.85 // overcast: a solid deck under the shapes
  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / height
    const horizon = 1 - smoothstep(0.93, 1, v) // fade the last rows into the fog
    for (let i = 0; i < width; i++) {
      const n = Math.min(1, Math.max(0, (noise(i / width, v) - 0.5) * 2.6 + 0.5))
      const a = Math.max(floor, smoothstep(threshold - 0.1, threshold + 0.15, n)) * horizon
      const k = (j * width + i) * 4
      const shade = 255 - 70 * a * n
      out[k] = out[k + 1] = out[k + 2] = shade
      out[k + 3] = 255 * a
    }
  }
  return out
}
