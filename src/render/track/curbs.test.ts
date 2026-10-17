import { describe, expect, it } from 'vitest'
import { CELL, ROAD_WIDTH, type Track } from '../../track/schema'
import { CURB_INNER, CURB_OUTER, CURB_TOP, curbDecals, DASH, DECAL_LIFT, EDGE_LINE, roadMarkings, STRIPE_LENGTH, TRIM_HALF_WIDTH } from './curbs'
import { ROAD_HALF_WIDTH, ROAD_TOP } from './zones'
import { LAP_NAMES, loadLap } from '../../track/registry'

const straight = (...lengths: number[]): Track => ({
  name: 't',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: lengths.map((length) => ({ type: 'straight', length })),
  gates: [],
})

// Curbs on a default-width road: PROFILE stretched by ROAD_WIDTH / CELL (geometry.ts roadScale).
const K = ROAD_WIDTH / CELL

const vertices = (p: Float32Array) => Array.from({ length: p.length / 3 }, (_, i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]])

describe('curbDecals', () => {
  it('lays red blocks on both curb tops, alternating every STRIPE_LENGTH across segment joints', () => {
    const { red } = curbDecals(straight(10, 10))
    const vs = vertices(red.positions)
    expect(vs.length).toBeGreaterThan(0)
    for (const [x, y, z] of vs) {
      expect(Math.abs(x)).toBeGreaterThanOrEqual(K * CURB_INNER - 1e-5)
      expect(Math.abs(x)).toBeLessThanOrEqual(K * CURB_OUTER + 1e-5)
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
      expect(Math.abs(x)).toBeGreaterThanOrEqual(K * (outer - EDGE_LINE.width) - 1e-5)
      expect(Math.abs(x)).toBeLessThanOrEqual(K * outer + 1e-5)
    }
  })

  it('leaves a gap (a jump with no road) bare', () => {
    const track: Track = { ...straight(10), segments: [{ type: 'straight', length: 10 }, { type: 'gap', length: 10 }, { type: 'straight', length: 10 }] }
    const { red, white } = curbDecals(track)
    for (const r of [red, white]) for (const [, , z] of vertices(r.positions)) expect(z <= 10 + 1e-6 || z >= 20 - 1e-6).toBe(true)
  })

  for (const name of LAP_NAMES) {
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

describe('roadMarkings', () => {
  it('test-flat: ≥ 10 centre dashes, every vertex on the asphalt at road top + 3 mm', () => {
    const track = loadLap('test-flat')
    const m = roadMarkings(track)
    expect(m.dashes).toBeGreaterThanOrEqual(10)
    expect(m.strips).toBe(0)
    expect(m.dashIndices).toBe(m.indices.length) // no surface patches: every index is a dash
    expect(m.indices.length % 3).toBe(0)
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3)
  })

  it('a straight: dashes DASH.length long every DASH.length + DASH.gap, within DASH.width of the centreline, 3 mm over the road', () => {
    const m = roadMarkings(straight(30))
    expect(m.dashes).toBe(5) // 0-3, 6-9, 12-15, 18-21, 24-27
    for (const [x, y, z] of vertices(m.positions)) {
      expect(Math.abs(x)).toBeLessThanOrEqual((K * DASH.width) / 2 + 1e-5)
      expect(y).toBeCloseTo(ROAD_TOP + DECAL_LIFT, 6)
      expect(z % (DASH.length + DASH.gap)).toBeLessThanOrEqual(DASH.length + 1e-6)
    }
  })

  it('runs the dash pattern on across a segment joint', () => {
    // Every vertex keeps the 30 m straight's phase (dashes at 0-3, 6-9 … m), whichever segment draws it.
    for (const t of [straight(10, 20), straight(2, 28)]) {
      for (const [, , z] of vertices(roadMarkings(t).positions)) expect(z % (DASH.length + DASH.gap)).toBeLessThanOrEqual(DASH.length + 1e-6)
    }
    expect(roadMarkings(straight(10, 20)).dashes).toBe(5)
    expect(roadMarkings(straight(2, 28)).dashes).toBe(6) // the first dash is drawn in two halves, either side of the 2 m joint
  })

  it('test-surfaces: one trim strip at each end of every surface patch, all inside the asphalt', () => {
    const track = loadLap('test-surfaces')
    const ends = 2 * (track.zones ?? []).filter((z) => ['dirt', 'ice', 'grass'].includes(z.kind)).length
    expect(ends).toBeGreaterThan(0)
    const m = roadMarkings(track)
    expect(m.strips).toBe(ends)
    expect(m.dashIndices).toBeLessThan(m.indices.length) // the strips follow the dashes
    expect(TRIM_HALF_WIDTH).toBeLessThan(ROAD_HALF_WIDTH)
    expect(m.positions.every(Number.isFinite)).toBe(true)
  })

  it('leaves a gap bare', () => {
    const track: Track = { ...straight(10), segments: [{ type: 'straight', length: 10 }, { type: 'gap', length: 10 }, { type: 'straight', length: 10 }] }
    for (const [, , z] of vertices(roadMarkings(track).positions)) expect(z <= 10 + 1e-6 || z >= 20 - 1e-6).toBe(true)
  })
})
