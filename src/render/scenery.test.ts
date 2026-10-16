import { describe, expect, it } from 'vitest'
import { centreline } from '../track/centreline'
import { loadLap } from './track/lap'
import { FIXTURE_TRACK } from './track/fixture'
import { CLEARANCE, planScenery } from './scenery'

const tracks = { lap1: loadLap('lap1'), lap2: loadLap('lap2'), crossover: loadLap('crossover'), tower: loadLap('tower'), fixture: FIXTURE_TRACK }

describe('planScenery', () => {
  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: places scenery, none of it within the clearance of any part of the road`, () => {
      const props = planScenery(track)
      expect(props.length).toBeGreaterThanOrEqual(15)
      const line = centreline(track, 1)
      for (const p of props) {
        const nearest = Math.min(...line.map((c) => Math.hypot(c.x - p.x, c.z - p.z)))
        expect(nearest).toBeGreaterThanOrEqual(CLEARANCE - 1) // 1 m: sampling step
      }
    })
  }

  it('is deterministic: same track, same scenery', () => {
    expect(planScenery(tracks.lap1)).toEqual(planScenery(tracks.lap1))
  })
})
