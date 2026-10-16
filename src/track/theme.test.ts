import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveTrack } from './kit'
import { layoutId, validate, validateTheme, type Track } from './schema'

const plunge = JSON.parse(readFileSync('assets/track/plunge.json', 'utf8')) as { theme?: unknown }
const test2 = JSON.parse(readFileSync('assets/track/test2.json', 'utf8')) as Track

describe('validateTheme', () => {
  it('accepts every lever set to a valid value', () => {
    const theme = {
      sky: 'night',
      skyLight: 0.3,
      exposure: 0.8,
      fog: '#101830',
      fogNear: 100,
      fogFar: 600,
      sun: '#9fb4ff',
      sunIntensity: 0.6,
      ground: '#3a5a40',
      curb: '#00c8ff',
      sign: '#ff3df0',
      screen: '#5b1a8a',
      scenery: ['tree_default', 'rock_largeA'],
    }
    expect(validateTheme(theme)).toEqual([])
  })

  it('rejects an unknown key, so a typo never silently does nothing', () => {
    expect(validateTheme({ skye: 'night' })).toEqual(['theme.skye: unknown key'])
  })

  it('rejects bad values lever by lever', () => {
    expect(validateTheme({ sky: 'noon' })[0]).toMatch(/^theme\.sky must be one of/)
    expect(validateTheme({ curb: 'red' })).toEqual(['theme.curb must be a #rrggbb colour'])
    expect(validateTheme({ exposure: 0 })).toEqual(['theme.exposure must be > 0'])
    expect(validateTheme({ fogNear: 900, fogFar: 300 })).toEqual(['theme.fogNear must be below theme.fogFar'])
    expect(validateTheme({ scenery: [] })).toEqual(['theme.scenery must be a non-empty list of Nature Kit model names'])
    expect(validateTheme({ scenery: ['../car'] })).toEqual(['theme.scenery must be a non-empty list of Nature Kit model names'])
    expect(validateTheme([])).toEqual(['theme must be an object'])
  })

  it('runs as part of track validation', () => {
    expect(validate({ ...test2, theme: { sky: 'noon' } }).some((e) => e.startsWith('theme.sky'))).toBe(true)
    expect(validate({ ...test2, theme: { sky: 'dusk' } })).toEqual([])
  })
})

describe('theme in the track format', () => {
  it('is not part of layoutId, so retheming a track keeps its records', () => {
    expect(layoutId({ ...test2, theme: { sky: 'night', curb: '#00c8ff' } })).toBe(layoutId(test2))
  })

  it('survives the kit compile', () => {
    const theme = { sky: 'sunset', curb: '#ff8800' }
    const track = resolveTrack({ ...plunge, theme }) as Track
    expect(track.theme).toEqual(theme)
    expect(validate(track)).toEqual([])
  })

  it('stays absent on a kit track without one', () => {
    const { theme: _, ...bare } = plunge
    expect((resolveTrack(bare) as Track).theme).toBeUndefined()
  })
})
