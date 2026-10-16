// Campaign identity: each A01–A05 track carries its own theme, and every pair of them differs in
// at least two levers, so the five campaign tracks read as five places (not one stadium recoloured).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Theme } from '../track/schema'
import { DEFAULT_THEME, resolveTheme } from './theme'

const CAMPAIGN = ['crossover', 'tower', 'plunge', 'knot', 'leap']
/** look.ts CURB_RED, linear (0.75, 0.04, 0.04), as sRGB hex. */
const DEFAULT_CURB = '#e13838'
/** Minimum CIE76 ΔE for a colour lever to count as changed. */
const COLOUR_DELTA = 15

const themeOf = (name: string) => resolveTheme({ theme: (JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as { theme?: Theme }).theme })

const lab = (hex: string): [number, number, number] => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))

type Look = ReturnType<typeof resolveTheme>
/** The five identity levers, each true when `a` and `b` differ in it. */
const differs = (a: Look, b: Look) => ({
  sky: a.sky !== b.sky,
  fog: deltaE(a.fog, b.fog) >= COLOUR_DELTA,
  ground: deltaE(a.ground, b.ground) >= COLOUR_DELTA,
  curb: deltaE(a.curb ?? DEFAULT_CURB, b.curb ?? DEFAULT_CURB) >= COLOUR_DELTA,
  scenery: [...a.scenery].sort().join() !== [...b.scenery].sort().join(),
})
const count = (d: Record<string, boolean>) => Object.values(d).filter(Boolean).length

describe('campaign track themes', () => {
  it('every campaign track carries a theme', () => {
    for (const name of CAMPAIGN) expect(themeOf(name), name).not.toEqual(DEFAULT_THEME)
  })

  for (const name of CAMPAIGN) {
    it(`${name} differs from the default look in at least 4 of 5 levers`, () => {
      expect(count(differs(themeOf(name), DEFAULT_THEME)), JSON.stringify(differs(themeOf(name), DEFAULT_THEME))).toBeGreaterThanOrEqual(4)
    })
  }

  for (let i = 0; i < CAMPAIGN.length; i++)
    for (let j = i + 1; j < CAMPAIGN.length; j++) {
      const [a, b] = [CAMPAIGN[i], CAMPAIGN[j]]
      it(`${a} and ${b} differ in at least 2 of 5 levers`, () => {
        const d = differs(themeOf(a), themeOf(b))
        expect(count(d), JSON.stringify(d)).toBeGreaterThanOrEqual(2)
      })
    }

  it('the default curb hex matches look.ts CURB_RED', () => {
    // linear 0.75 → sRGB 225 (0xe1), linear 0.04 → sRGB 56 (0x38)
    const toSrgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
    expect(`#${[0.75, 0.04, 0.04].map((c) => toSrgb(c).toString(16).padStart(2, '0')).join('')}`).toBe(DEFAULT_CURB)
  })
})
