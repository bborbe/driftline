import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import { CLEARANCE } from '../scenery'
import { FIXTURE_TRACK } from '../track/fixture'
import { loadLap } from '../track/lap'
import { planStadium, STADIUM_GAP } from './stadium'

const tracks = { lap1: loadLap('lap1'), lap2: loadLap('lap2'), fixture: FIXTURE_TRACK }

describe('planStadium', () => {
  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: a ring of stands, towers, lights and screens, all well outside the lap and its scenery`, () => {
      const props = planStadium(track)
      const models = new Set(props.map((p) => p.model))
      for (const m of ['grandStand', 'grandStandCovered', 'screen', 'lightPostLarge']) expect(models, m).toContain(m)
      const line = centreline(track, 1)
      for (const p of props) {
        const nearest = Math.min(...line.map((c) => Math.hypot(c.x - p.x, c.z - p.z)))
        expect(nearest).toBeGreaterThanOrEqual(STADIUM_GAP - 1)
      }
      expect(STADIUM_GAP).toBeGreaterThan(CLEARANCE + 2 + 28 + 7) // past the farthest tree (scenery.ts)
    })
  }

  it('faces every stand toward the track', () => {
    const track = tracks.lap2
    const line = centreline(track, 4)
    const cx = line.reduce((a, p) => a + p.x, 0) / line.length
    const cz = line.reduce((a, p) => a + p.z, 0) / line.length
    for (const p of planStadium(track).filter((q) => q.model.startsWith('grandStand'))) {
      const facing = Math.sin(p.heading) * (cx - p.x) + Math.cos(p.heading) * (cz - p.z)
      expect(facing).toBeGreaterThan(0)
    }
  })
})
