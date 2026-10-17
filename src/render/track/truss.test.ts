import { describe, expect, it } from 'vitest'
import { DECK_PILLAR_SIZE, pillarBoxes, planDeckPillars } from '../../track/bodies'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { MIN_THICKNESS } from '../lint'
import { memberCorners, planTruss, TRUSS_BRACE, TRUSS_LEG } from './truss'

const EPS = 1e-6

describe('planTruss', () => {
  it('ships bridges to dress: at least one track has deck pillars', () => {
    expect(LAP_NAMES.some((n) => planDeckPillars(loadLap(n)).length > 0)).toBe(true)
  })

  for (const name of LAP_NAMES) {
    it(`${name}: one truss per deck pillar, every member inside the pillar's collider`, () => {
      const track = loadLap(name)
      const pillars = planDeckPillars(track)
      const boxes = pillarBoxes(track)
      expect(boxes).toHaveLength(pillars.length)
      pillars.forEach((p, i) => {
        const { legs, braces } = planTruss(p)
        expect(legs).toHaveLength(4)
        expect(braces.length).toBeGreaterThanOrEqual(4) // at least one diagonal per face
        const box = boxes[i]
        for (const m of [...legs, ...braces]) {
          for (const [x, y, z] of memberCorners(m)) {
            expect(Math.abs(x - box.x)).toBeLessThanOrEqual(box.halfWidth + EPS)
            expect(Math.abs(z - box.z)).toBeLessThanOrEqual(box.halfDepth + EPS)
            expect(y).toBeGreaterThanOrEqual(-EPS)
            expect(y).toBeLessThanOrEqual(box.height + EPS)
          }
        }
        // Legs run ground to deck underside, so the deck stands on them.
        for (const l of legs) expect([l.y - l.sy / 2, l.y + l.sy / 2]).toEqual([0, expect.closeTo(p.top, 6)])
      })
    })
  }

  it('members are not paper-thin', () => {
    expect(Math.min(TRUSS_LEG, TRUSS_BRACE)).toBeGreaterThanOrEqual(MIN_THICKNESS)
  })

  it('diagonals join opposite legs across their bay', () => {
    const p = { x: 3, z: -2, top: 9 }
    const { braces } = planTruss(p)
    const c = DECK_PILLAR_SIZE / 2 - TRUSS_LEG / 2
    const diagonals = braces.filter((b) => b.roll !== 0)
    expect(diagonals).toHaveLength(4 * 3) // 9 m → three 3 m bays per face
    for (const d of diagonals) {
      // The member's axis end points: ±len/2 along its length axis, rotated.
      const half = (d.axis === 'z' ? d.sx : d.sz) / 2
      const ends = [-1, 1].map((s) => (d.axis === 'z' ? [d.x + s * half * Math.cos(d.roll), d.y + s * half * Math.sin(d.roll)] : [d.z + s * half * Math.cos(d.roll), d.y + s * half * Math.sin(d.roll)]))
      const centre = d.axis === 'z' ? p.x : p.z
      for (const [u] of ends) expect(Math.abs(Math.abs(u - centre) - c)).toBeLessThan(1e-9)
      expect(Math.abs(ends[0][1] - ends[1][1])).toBeCloseTo(3 - 2 * TRUSS_BRACE, 9)
    }
  })
})
