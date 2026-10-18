import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SKIES, type Theme } from '../track/schema'
import { SCENERY_MODELS } from './scenery'
import { DEFAULT_THEME, resolveTheme, SKY_BRIGHTNESS, SKY_FILES, skyUrl } from './theme'

describe('resolveTheme', () => {
  it('without a theme is the grounded stadium look', () => {
    expect(resolveTheme({})).toEqual({
      sky: 'day',
      skyLight: 0.35,
      exposure: 0.9,
      fog: '#c8d4dc',
      fogNear: 160,
      fogFar: 900,
      sun: '#fff4e0',
      sunIntensity: 2.5,
      ground: '#7fc25a',
      scenery: SCENERY_MODELS,
    })
    // Curb, sign and screen stay unset, so their owners keep their own constants (look.ts, stadium.ts).
    const resolved = resolveTheme({})
    expect(resolved.curb).toBeUndefined()
    expect(resolved.sign).toBeUndefined()
    expect(resolved.screen).toBeUndefined()
  })

  it('overrides only the levers a theme sets', () => {
    const r = resolveTheme({ theme: { sky: 'night', curb: '#00c8ff', scenery: ['tree_palm'] } })
    // `stand` is the one derived lever: it follows `curb` unless the theme names its own (stand-colour.test.ts).
    expect(r).toEqual({ ...DEFAULT_THEME, sky: 'night', curb: '#00c8ff', stand: '#00c8ff', scenery: ['tree_palm'] })
  })
})

describe('theme assets', () => {
  it('every sky has its HDRI on disk and bundled', () => {
    for (const sky of SKIES) {
      expect(existsSync(`assets/sky/${SKY_FILES[sky]}`)).toBe(true)
      expect(skyUrl(sky)).toBeTruthy()
    }
  })

  it('every sky has a dome intensity; day keeps its look, the brighter HDRIs are dimmed', () => {
    // Calibrated on start-pose shots: at intensity 1 the sunset, dusk, night and overcast domes clip
    // to white haze under ACES, while the partly cloudy day sky keeps its clouds.
    expect(SKY_BRIGHTNESS.day).toBe(1)
    for (const sky of SKIES.filter((s) => s !== 'day')) {
      expect(SKY_BRIGHTNESS[sky], sky).toBeGreaterThan(0)
      expect(SKY_BRIGHTNESS[sky], sky).toBeLessThanOrEqual(0.5)
    }
    expect(SKY_BRIGHTNESS.night).toBeLessThan(Math.min(SKY_BRIGHTNESS.dusk, SKY_BRIGHTNESS.sunset, SKY_BRIGHTNESS.overcast))
  })

  it('every sky HDRI is listed in the Poly Haven licence file', () => {
    const licence = readFileSync('assets/LICENSES/polyhaven.txt', 'utf8')
    for (const sky of SKIES) expect(licence).toContain(`assets/sky/${SKY_FILES[sky]}`)
  })

  it('every scenery model a shipped track names exists in assets/nature-kit', () => {
    const models: string[] = [...SCENERY_MODELS]
    for (const f of readdirSync('assets/track').filter((n) => n.endsWith('.json') && n !== 'pieces.json')) {
      const theme = (JSON.parse(readFileSync(`assets/track/${f}`, 'utf8')) as { theme?: Theme }).theme
      models.push(...(theme?.scenery ?? []))
    }
    for (const m of models) expect(existsSync(`assets/nature-kit/${m}.glb`), m).toBe(true)
  })
})
