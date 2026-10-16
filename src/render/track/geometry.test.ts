import { describe, expect, it } from 'vitest'
import { poses, SEGMENT_TYPES, validate } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'
import { trackSurface } from '../../physics'
import type { Segment } from '../../track/schema'
import { buildApron, buildTrack, rowCenter, sampleSegment, SURFACE_LIFT, type SegmentGeometry } from './geometry'

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

  it('banked turn surface matches the physics surface (src/track/bank.ts)', () => {
    const b = indexOf('banked')
    const seg = segs[b] as Segment & { type: 'banked' }
    const surf = trackSurface({ ...FIXTURE_TRACK, segments: [seg], start: ps[b] }, { groundY: null })
    const g = geoms[b]
    for (let row = 0; row < g.rows; row++) {
      for (let c = 0; c < g.perRow - 2; c++) {
        const i = (row * g.perRow + c) * 3
        const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]]
        const hit = surf.raycast({ x, y: y + 5, z }, { x: 0, y: -1, z: 0 }, 20)
        if (hit) expect(y - SURFACE_LIFT - (y + 5 - hit.distance), `row ${row} col ${c}`).toBeCloseTo(0, 3)
      }
    }
  })

  it('banked turn starts and ends flat, reaching its full bank mid-turn', () => {
    const b = indexOf('banked')
    const seg = segs[b] as { bank: number }
    expect(sampleSegment(ps[b], segs[b], 0).roll).toBe(0)
    expect(sampleSegment(ps[b], segs[b], 1).roll).toBe(0)
    expect(sampleSegment(ps[b], segs[b], 0.5).roll).toBeCloseTo(seg.bank, 9)
  })

  it('banked apron rises from the dipped inner edge to the road plane, and the skirt drops to it', () => {
    const b = indexOf('banked')
    const apron = buildApron(ps[b], segs[b])!
    const y = (row: number, k: number) => apron.positions[(row * apron.perRow + k) * 3 + 1] - SURFACE_LIFT
    const mid = Math.floor(apron.rows / 2)
    expect(y(mid, 0)).toBeLessThan(ps[b].y - 0.5) // inner edge dips mid-turn
    expect(y(mid, 1)).toBeCloseTo(ps[b].y, 6) // apron rim on the road plane
    expect(y(mid, 2)).toBeGreaterThan(ps[b].y + 0.5) // outer edge raised
    expect(y(mid, 3)).toBeCloseTo(ps[b].y, 6) // skirt foot on the road plane
    expect(buildApron(ps[0], segs[0])).toBeNull()
  })
})
