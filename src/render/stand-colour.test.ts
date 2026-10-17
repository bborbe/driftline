// Venue stand colour: theme `stand`, else the venue's curb accent. The three venues the stadium
// dressing is judged on must read as three places by their stands alone.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Theme } from '../track/schema'
import { resolveTheme } from './theme'

const VENUES = ['flatout', 'glacier', 'showcase']
/** Minimum CIE76 ΔE for two colours to count as different (campaign-themes.test.ts). */
const COLOUR_DELTA = 15

const themeOf = (name: string) => (JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as { theme?: Theme }).theme

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

describe('venue stand colour', () => {
  it('falls back to the curb accent, and a theme can name its own', () => {
    expect(resolveTheme({ theme: { curb: '#123456' } }).stand).toBe('#123456')
    expect(resolveTheme({ theme: { curb: '#123456', stand: '#abcdef' } }).stand).toBe('#abcdef')
    expect(resolveTheme({}).stand).toBeUndefined()
  })

  it('flatout, glacier and showcase stands differ pairwise', () => {
    const stands = VENUES.map((v) => resolveTheme({ theme: themeOf(v) }).stand)
    for (const s of stands) expect(s).toMatch(/^#[0-9a-f]{6}$/i)
    for (let i = 0; i < stands.length; i++)
      for (let j = i + 1; j < stands.length; j++) expect(deltaE(stands[i]!, stands[j]!), `${VENUES[i]} vs ${VENUES[j]}`).toBeGreaterThanOrEqual(COLOUR_DELTA)
  })
})
