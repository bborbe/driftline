import { describe, expect, it } from 'vitest'
import type { Track } from '../../track/schema'
import { CURB_INNER, CURB_OUTER, CURB_TOP, curbDecals, DECAL_LIFT, EDGE_LINE, STRIPE_LENGTH } from './curbs'
import { loadLap } from './lap'

const straight = (...lengths: number[]): Track => ({
  name: 't',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: lengths.map((length) => ({ type: 'straight', length })),
  gates: [],
})

const vertices = (p: Float32Array) => Array.from({ length: p.length / 3 }, (_, i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]])

describe('curbDecals', () => {
  it('lays red blocks on both curb tops, alternating every STRIPE_LENGTH across segment joints', () => {
    const { red } = curbDecals(straight(10, 10))
    const vs = vertices(red.positions)
    expect(vs.length).toBeGreaterThan(0)
    for (const [x, y, z] of vs) {
      expect(Math.abs(x)).toBeGreaterThanOrEqual(CURB_INNER - 1e-6)
      expect(Math.abs(x)).toBeLessThanOrEqual(CURB_OUTER + 1e-6)
      expect(y).toBeCloseTo(CURB_TOP + DECAL_LIFT, 6)
      // Red blocks start at 0, 4, 8 … m: every vertex lies in the first half of a 2-block period.
      const phase = z % (2 * STRIPE_LENGTH)
      expect(phase <= STRIPE_LENGTH + 1e-6 || phase >= 2 * STRIPE_LENGTH - 1e-6).toBe(true)
    }
    // Five blocks per 10 m segment: red at 0,4,8 (seg 1) and 12,16 (seg 2 continues the pattern).
    const starts = new Set(vs.map(([, , z]) => Math.round(z)).filter((z) => z % 4 === 0 && z < 20))
    expect([...starts].sort((a, b) => a - b)).toEqual([0, 4, 8, 12, 16])
  })

  it('draws a white edge line on the asphalt just inside each curb', () => {
    const { white } = curbDecals(straight(20))
    const lines = vertices(white.positions).filter(([, y]) => y < CURB_TOP)
    expect(lines.length).toBeGreaterThan(0)
    const outer = CURB_INNER - EDGE_LINE.inset
    for (const [x] of lines) {
      expect(Math.abs(x)).toBeGreaterThanOrEqual(outer - EDGE_LINE.width - 1e-6)
      expect(Math.abs(x)).toBeLessThanOrEqual(outer + 1e-6)
    }
  })

  for (const name of ['lap1', 'lap2']) {
    it(`${name}: covers every segment with finite, indexed geometry`, () => {
      const { red, white } = curbDecals(loadLap(name))
      for (const r of [red, white]) {
        expect(r.indices.length % 3).toBe(0)
        expect(Math.max(...r.indices)).toBeLessThan(r.positions.length / 3)
        expect(r.positions.every(Number.isFinite)).toBe(true)
      }
    })
  }
})
