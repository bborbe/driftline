import { describe, expect, it } from 'vitest'
import { bandRange, BANDS, clampLivery, drawLivery, ghostLivery, hue, hueDistance, NUMBER_PLATES, PAINT_IDS, PAINTS, PATTERNS, type Draw2D } from './livery'

/** A 2D context that records fillText calls with the band they land in. */
const recorder = (size: number) => {
  let ty = 0
  const stack: number[] = []
  const texts: { text: string; band: string }[] = []
  const g: Draw2D = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    arc: () => {},
    fill: () => {},
    fillText: (text) => texts.push({ text, band: BANDS[Math.floor(ty / (size / BANDS.length))] }),
    save: () => void stack.push(ty),
    restore: () => void (ty = stack.pop()!),
    translate: (_x, y) => void (ty += y),
    scale: () => {},
    rotate: () => {},
  }
  return { g, texts }
}

describe('liveries', () => {
  it('has six distinct patterns and saturated paints', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(PATTERNS).size).toBe(PATTERNS.length)
    for (const p of PAINT_IDS) expect(PAINTS[p]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('draws the race number on the nose and both sides', () => {
    expect(NUMBER_PLATES.map((p) => p.at).sort()).toEqual(['left', 'nose', 'right'])
    const { g, texts } = recorder(1024)
    drawLivery(g, { pattern: 'stripes', paint: 'blue', number: 42 }, 1024)
    expect(texts).toEqual([
      { text: '42', band: 'top' },
      { text: '42', band: 'left' },
      { text: '42', band: 'right' },
    ])
  })

  it('gives the ghost a different pattern and a hue at least 90° away, for every livery', () => {
    for (const pattern of PATTERNS)
      for (const paint of PAINT_IDS) {
        const g = ghostLivery({ pattern, paint, number: 5 })
        expect(g.pattern).not.toBe(pattern)
        expect(hueDistance(hue(PAINTS[g.paint]), hue(PAINTS[paint]))).toBeGreaterThanOrEqual(90)
      }
  })

  it('clamps stored values', () => {
    expect(clampLivery(null)).toEqual({ pattern: 'stripes', paint: 'orange', number: 7 })
    expect(clampLivery({ pattern: 'checker', paint: 'pink', number: '12' })).toEqual({ pattern: 'checker', paint: 'pink', number: 12 })
    expect(clampLivery({ number: 0 }).number).toBe(7)
    expect(clampLivery({ number: 1000 }).number).toBe(99)
  })

  it('splits the atlas into disjoint bands', () => {
    const ranges = BANDS.map(bandRange).sort((a, b) => a[0] - b[0])
    expect(ranges[0][0]).toBe(0)
    expect(ranges.at(-1)![1]).toBe(1)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeCloseTo(ranges[i - 1][1])
  })
})
