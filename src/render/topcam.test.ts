import { describe, expect, it } from 'vitest'
import { centreline } from '../track/centreline'
import { loadLap } from './track/lap'
import { topCamFor, topCamRequested } from './topcam'

describe('?cam=top', () => {
  it('is requested only by cam=top', () => {
    expect(topCamRequested('?cam=top&freeze=1')).toBe(true)
    expect(topCamRequested('?freeze=1')).toBe(false)
  })

  for (const name of ['test1', 'test2']) {
    it(`${name}: every centreline point is inside the view`, () => {
      const track = loadLap(name)
      const fov = 70
      const aspect = 16 / 9
      const c = topCamFor(track, fov, aspect)
      const tan = Math.tan(((fov / 2) * Math.PI) / 180)
      for (const p of centreline(track, 2)) {
        expect(Math.abs(p.z - c.z)).toBeLessThanOrEqual(c.y * tan)
        expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(c.y * tan * aspect)
      }
    })
  }
})
