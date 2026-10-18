// Resolves a track's optional `theme` (src/track/theme.ts) against the default stadium look, so a
// track without a theme renders the shared stadium look. The lighting defaults are the grounded day
// look: a lower exposure and image light than the first stadium look, so whites keep detail and
// shadows read, a stronger sun to keep sunlit surfaces as bright, and fog pulled in and tinted to the
// day sky's horizon, so the far stands fade into the sky (atmospheric perspective). Colour levers that look.ts already owns (curb, sign, screen) resolve to
// `undefined` when unset: the caller then keeps its own constant, not a hex round-trip of it. `stand`
// falls back to `curb`, so every themed venue gets its own stand colour.
import type { Sky, Theme, Track } from '../track/schema'

const SKY_URLS = import.meta.glob('/assets/sky/*.hdr', { query: '?url', import: 'default', eager: true }) as Record<string, string>

/** Poly Haven HDRI per sky (assets/LICENSES/polyhaven.txt). */
export const SKY_FILES: Record<Sky, string> = {
  day: 'kloofendal_48d_partly_cloudy_puresky_1k.hdr',
  sunset: 'qwantani_sunset_puresky_1k.hdr',
  dusk: 'qwantani_dusk_2_puresky_1k.hdr',
  night: 'qwantani_night_puresky_1k.hdr',
  overcast: 'kloofendal_overcast_puresky_1k.hdr',
}

/**
 * Sky dome (background) intensity per sky. The puresky HDRIs are not on one radiometric scale: next
 * to the partly cloudy `day` sky the others are far brighter for their look (the night sky is
 * exposed to near daylight), and at intensity 1 ACES clips their dome to white haze. These factors
 * bring each dome back to its own mood. They scale only the background, never the environment light
 * (`skyLight`) a theme's lighting is tuned against.
 */
export const SKY_BRIGHTNESS: Record<Sky, number> = {
  day: 1,
  sunset: 0.3,
  dusk: 0.35,
  night: 0.08,
  overcast: 0.35,
}

export const skyUrl = (sky: Sky): string => {
  const url = SKY_URLS[`/assets/sky/${SKY_FILES[sky]}`]
  if (!url) throw new Error(`no asset for sky "${sky}"`)
  return url
}

/** The default scenery: Kenney Nature Kit trees and rocks (assets/nature-kit/). */
export const DEFAULT_SCENERY = ['tree_default', 'tree_cone', 'tree_detailed', 'tree_default_dark', 'rock_largeA', 'rock_tallA'] as const

export type ResolvedTheme = {
  sky: Sky
  skyLight: number
  exposure: number
  fog: string
  fogNear: number
  fogFar: number
  sun: string
  sunIntensity: number
  ground: string
  curb?: string
  sign?: string
  screen?: string
  stand?: string
  scenery: readonly string[]
}

export const DEFAULT_THEME: ResolvedTheme = {
  sky: 'day',
  skyLight: 0.35,
  exposure: 0.9,
  fog: '#c8d4dc', // the day HDRI's horizon as rendered, between the sky above it and the hazed ground
  fogNear: 160,
  fogFar: 900,
  sun: '#fff4e0',
  sunIntensity: 2.5,
  ground: '#7fc25a',
  scenery: DEFAULT_SCENERY,
}

/** The track's look: its theme over the defaults, field by field. */
export const resolveTheme = (track: Pick<Track, 'theme'>): ResolvedTheme => {
  const t: Theme = track.theme ?? {}
  const set = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined))
  // A venue's stands wear its accent unless the theme names its own stand colour.
  return { ...DEFAULT_THEME, ...set, stand: t.stand ?? t.curb }
}
