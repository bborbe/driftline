import { describe, expect, it } from 'vitest'
import { centreline } from '../track/centreline'
import { loadLap } from '../track/registry'
import { FIXTURE_TRACK } from '../track/fixture'
import { CLEARANCE, planScenery, sceneryModels, SCENERY_MODELS } from './scenery'
import { GEN_BUILDINGS, GEN_TREES } from './decor/variants'
import { footprints, planTrackside } from './decor/trackside-plan'

const tracks = { test1: loadLap('test1'), test2: loadLap('test2'), crossover: loadLap('crossover'), tower: loadLap('tower'), plunge: loadLap('plunge'), knot: loadLap('knot'), leap: loadLap('leap'), fixture: FIXTURE_TRACK }

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

  for (const name of ['test1', 'test2'] as const) {
    const props = planScenery(tracks[name], 9, 7, sceneryModels(SCENERY_MODELS), footprints(planTrackside(tracks[name])))

    it(`${name}: irregular spacing — consecutive gaps along the lap vary by ≥ 25% of their mean`, () => {
      const trees = props.filter((p) => !(GEN_BUILDINGS as readonly string[]).includes(p.model))
      const gaps = trees.slice(1).map((p, i) => p.at - trees[i].at)
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
      const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
      expect(sd / mean).toBeGreaterThanOrEqual(0.25)
    })

    it(`${name}: shows ≥ 3 generated tree variants and ≥ 3 building variants`, () => {
      const used = new Set(props.map((p) => p.model))
      expect(GEN_TREES.filter((m) => used.has(m)).length).toBeGreaterThanOrEqual(3)
      expect(GEN_BUILDINGS.filter((m) => used.has(m)).length).toBeGreaterThanOrEqual(3)
    })

    it(`${name}: no prop on a trackside board, banner, marshal post or fence`, () => {
      for (const [x, z, r] of footprints(planTrackside(tracks[name]))) {
        for (const p of props) expect(Math.hypot(p.x - x, p.z - z), p.model).toBeGreaterThanOrEqual(r)
      }
    })
  }

  it('is deterministic: same track, same scenery', () => {
    expect(planScenery(tracks.test1)).toEqual(planScenery(tracks.test1))
  })
})
