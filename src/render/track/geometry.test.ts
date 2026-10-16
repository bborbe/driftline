import { describe, expect, it } from 'vitest'
import { poses, SEGMENT_TYPES, validate } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'
import { buildTrack, lateralPoint, rowCenter, sampleSegment, SURFACE_LIFT, type SegmentGeometry } from './geometry'

const geoms = buildTrack(FIXTURE_TRACK)
const ps = poses(FIXTURE_TRACK)
const segs = FIXTURE_TRACK.segments
const indexOf = (type: string) => segs.findIndex((s) => s.type === type)

const maxY = (g: SegmentGeometry) => {
  let m = -Infinity
  for (let i = 1; i < g.positions.length; i += 3) m = Math.max(m, g.positions[i])
  return m
}

describe('render track geometry', () => {
  it('fixture is a valid track covering every segment type', () => {
    expect(validate(FIXTURE_TRACK)).toEqual([])
    for (const t of SEGMENT_TYPES) expect(indexOf(t), t).toBeGreaterThanOrEqual(0)
  })

  it('builds at least 100 triangles for every segment', () => {
    geoms.forEach((g, i) => expect(g.indices.length / 3, segs[i].type).toBeGreaterThanOrEqual(100))
  })

  it('has no NaN vertices and in-range indices', () => {
    for (const g of geoms) {
      expect(g.positions.every(Number.isFinite)).toBe(true)
      expect(Math.max(...g.indices)).toBeLessThan(g.positions.length / 3)
    }
  })

  it('surface faces up on a flat straight', () => {
    const g = geoms[0]
    const p = (i: number) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]]
    const [a, b, c] = [p(g.indices[0]), p(g.indices[1]), p(g.indices[2])]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0) // normal.y
  })

  it('every segment exit edge meets the next poses() entry within 1 cm', () => {
    geoms.forEach((g, i) => {
      const [x, y, z] = rowCenter(g, g.rows - 1)
      const next = ps[i + 1]
      expect(Math.hypot(x - next.x, y - SURFACE_LIFT - next.y, z - next.z), segs[i].type).toBeLessThan(0.01)
    })
  })

  it('ramp rises by its rise and drop falls by its fall', () => {
    const r = indexOf('ramp')
    const d = indexOf('drop')
    const ramp = segs[r] as { rise: number }
    const drop = segs[d] as { fall: number }
    expect(rowCenter(geoms[r], geoms[r].rows - 1)[1] - rowCenter(geoms[r], 0)[1]).toBeCloseTo(ramp.rise, 3)
    expect(rowCenter(geoms[d], 0)[1] - rowCenter(geoms[d], geoms[d].rows - 1)[1]).toBeCloseTo(drop.fall, 3)
    expect(maxY(geoms[r])).toBeGreaterThan(ps[r].y + ramp.rise)
  })

  it('banked turn matches the physics surface: outer edge raised by (r - radius) * tan(bank)', () => {
    const b = indexOf('banked')
    const seg = segs[b] as { bank: number; turn: 'left' | 'right' }
    const p = sampleSegment(ps[b], segs[b], 0.5)
    expect(p.roll).toBe(seg.bank)
    const outer = seg.turn === 'right' ? 1 : -1 // lateral u > 0 is left of travel
    const s = seg.turn === 'right' ? -1 : 1
    const [, y] = lateralPoint(p, outer * 5, s)
    expect(y - SURFACE_LIFT - p.y).toBeCloseTo(5 * Math.tan(seg.bank), 6)
  })
})
