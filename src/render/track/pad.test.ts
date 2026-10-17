import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Track } from '../../track/schema'
import { GUIDE_LINE, padGuides } from './pad'
import { ROAD_TOP } from './zones'

const track = JSON.parse(readFileSync(new URL('../../../assets/track/test-pad.json', import.meta.url), 'utf8')) as Track
const pad = track.pad!
const guides = padGuides(pad)
const ys = (a: Float32Array) => a.filter((_, i) => i % 3 === 1)

describe('test-pad guides', () => {
  it('paints circles of radius 15, 40 and 80 m about the circle centre', () => {
    expect(pad.circles).toEqual([15, 40, 80])
    guides.circles.forEach((c, k) => {
      for (let i = 0; i < c.length; i += 3) {
        const r = Math.hypot(c[i] - pad.circleCentre[0], c[i + 2] - pad.circleCentre[1])
        expect(Math.abs(r - pad.circles[k])).toBeLessThanOrEqual(GUIDE_LINE / 2 + 1e-4)
      }
    })
  })

  it('marks the straight lane every 50 m, ends included', () => {
    expect(pad.lane.marks).toBe(50)
    const length = Math.hypot(pad.lane.to[0] - pad.lane.from[0], pad.lane.to[1] - pad.lane.from[1])
    // Two triangles (6 vertices) per mark.
    expect(guides.marks.length / 18).toBe(Math.floor(length / 50) + 1)
    expect(guides.lane.length).toBeGreaterThan(0)
  })

  it('every guide sits at road top + 3 mm, the decal height', () => {
    for (const a of [...guides.circles, guides.lane, guides.marks]) {
      for (const y of ys(a)) expect(y).toBeCloseTo(ROAD_TOP + 0.003, 6)
    }
  })
})
