import { describe, expect, it } from 'vitest'
import { loadLap } from '../track/registry'
import { centreline } from '../track/centreline'
import { CELL } from '../track/schema'
import { KERB_INNER, KERB_OUTER, KerbProbe, lateralOffset, onKerbBand } from './kerb'

describe('onKerbBand', () => {
  it('is off on the centreline and the grass, on over the curb band', () => {
    expect(onKerbBand(0, CELL)).toBe(false)
    expect(onKerbBand(1.5, CELL)).toBe(false)
    expect(onKerbBand((KERB_INNER + KERB_OUTER) / 2, CELL)).toBe(true)
    expect(onKerbBand(-(KERB_INNER + KERB_OUTER) / 2, CELL)).toBe(true)
    expect(onKerbBand(7, CELL)).toBe(false)
  })
  it('stretches with the road width', () => {
    expect(onKerbBand(3.8, 2 * CELL)).toBe(false)
    expect(onKerbBand(7.6, 2 * CELL)).toBe(true)
  })
})

describe('lateralOffset', () => {
  it('is perpendicular to the heading', () => {
    const p = { x: 0, y: 0, z: 0, heading: 0 } // forward +z
    expect(lateralOffset(p, 0, 5)).toBeCloseTo(0)
    expect(Math.abs(lateralOffset(p, 3, 0))).toBeCloseTo(3)
  })
})

describe('KerbProbe on test1', () => {
  const track = loadLap('test1')
  const probe = new KerbProbe(track)
  const line = centreline(track, 1)
  it('a car on the centreline is never on a kerb; one beside it on the curb band is', () => {
    let off = 0
    let on = 0
    for (const p of line.filter((_, i) => i % 7 === 3)) {
      if (probe.onKerb({ x: p.x, y: p.y + 0.5, z: p.z })) off++
      const u = ((KERB_INNER + KERB_OUTER) / 2) * (p.width / CELL)
      if (probe.onKerb({ x: p.x + Math.cos(p.heading) * u, y: p.y + 0.5, z: p.z - Math.sin(p.heading) * u })) on++
    }
    expect(off).toBe(0)
    expect(on).toBeGreaterThan(0.9 * Math.ceil(line.length / 7))
  })
})
