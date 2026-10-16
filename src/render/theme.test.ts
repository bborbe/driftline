import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SKIES, type Theme } from '../track/schema'
import { SCENERY_MODELS } from './scenery'
import { DEFAULT_THEME, resolveTheme, SKY_FILES, skyUrl } from './theme'

describe('resolveTheme', () => {
  it('without a theme is the stadium look as it was before themes existed', () => {
    expect(resolveTheme({})).toEqual({
      sky: 'day',
      skyLight: 0.45,
      exposure: 1,
      fog: '#b9d4e8',
      fogNear: 250,
      fogFar: 1200,
      sun: '#fff4e0',
      sunIntensity: 2.2,
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
    expect(r).toEqual({ ...DEFAULT_THEME, sky: 'night', curb: '#00c8ff', scenery: ['tree_palm'] })
  })
})

describe('theme assets', () => {
  it('every sky has its HDRI on disk and bundled', () => {
    for (const sky of SKIES) {
      expect(existsSync(`assets/sky/${SKY_FILES[sky]}`)).toBe(true)
      expect(skyUrl(sky)).toBeTruthy()
    }
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
