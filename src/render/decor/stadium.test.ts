import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { CLEARANCE } from '../scenery'
import { FIXTURE_TRACK } from '../../track/fixture'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { planStadium, SCREEN_FACE, STADIUM_GAP } from './stadium'

// Every shipped track (campaign, test and multi-level) plus the all-segment-types fixture.
const tracks: Record<string, Track> = { ...Object.fromEntries(LAP_NAMES.map((n) => [n, loadLap(n)])), fixture: FIXTURE_TRACK }

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
    const track = tracks.test2
    const line = centreline(track, 4)
    const cx = line.reduce((a, p) => a + p.x, 0) / line.length
    const cz = line.reduce((a, p) => a + p.z, 0) / line.length
    for (const p of planStadium(track).filter((q) => q.model.startsWith('grandStand'))) {
      const facing = Math.sin(p.heading) * (cx - p.x) + Math.cos(p.heading) * (cz - p.z)
      expect(facing).toBeGreaterThan(0)
    }
  })
})

describe('screen face', () => {
  // The camera's near plane (render/view.ts) and a 24-bit depth buffer: one depth step at distance
  // d is about d² / (near · 2^24). Far from the screens the old 2 cm lift was below one step.
  const NEAR = 0.1
  const depthStep = (d: number) => (d * d) / (NEAR * 2 ** 24)
  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: stands proud of the body by more than a depth step at the farthest screen`, () => {
      const line = centreline(track, 4)
      const screens = planStadium(track).filter((p) => p.model === 'screen')
      const farthest = Math.max(...screens.flatMap((s) => line.map((c) => Math.hypot(c.x - s.x, c.z - s.z))))
      expect(SCREEN_FACE.lift).toBeGreaterThan(depthStep(farthest))
      expect(SCREEN_FACE.polygonOffsetUnits).toBeLessThan(0) // and wins by depth bias too
    })
  }
})
