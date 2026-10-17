import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { CLEARANCE } from '../scenery'
import { FIXTURE_TRACK } from '../../track/fixture'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { MODEL_OFFSET, planCrowd, planStadium, SCREEN_FACE, SEAT_TIERS, SEAT_X, STADIUM_GAP } from './stadium'

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

describe('planCrowd', () => {
  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: every grandstand seats at least 40 spectators, all on its steps`, () => {
      const props = planStadium(track)
      const crowd = planCrowd(props)
      const stands = props.filter((p) => p.model === 'grandStand' || p.model === 'grandStandCovered')
      expect(stands.length).toBeGreaterThan(0)
      for (const s of stands) {
        // A spectator belongs to the stand whose footprint (21 m across, 24 m deep at most) holds it.
        const mine = crowd.filter((c) => Math.hypot(c.x - s.x, c.z - s.z) < s.scale)
        expect(mine.length).toBeGreaterThanOrEqual(40)
        const steps = SEAT_TIERS.map((t) => (t.y + MODEL_OFFSET[1]) * s.scale)
        for (const c of mine) expect(steps.some((y) => Math.abs(y - c.y) < 1e-9)).toBe(true)
      }
    })
  }

  it('the crowd is the same on every plan', () => {
    expect(planCrowd(planStadium(tracks.test2))).toEqual(planCrowd(planStadium(tracks.test2)))
  })
})

describe('seat tiers', () => {
  // Re-read the step tops from both grandstand models: the up-facing faces between the first step and the landing.
  for (const model of ['grandStand', 'grandStandCovered']) {
    it(`${model}.glb steps match SEAT_TIERS, SEAT_X and MODEL_OFFSET`, () => {
      const glb = readFileSync(`assets/racing-kit/${model}.glb`)
      const jsonLength = glb.readUInt32LE(12)
      const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
      const bin = glb.subarray(20 + jsonLength + 8)
      expect(gltf.nodes[0].translation).toEqual(MODEL_OFFSET)
      const prim = gltf.meshes[0].primitives[0]
      const read = (index: number) => {
        const acc = gltf.accessors[index]
        const view = gltf.bufferViews[acc.bufferView]
        const at = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
        return Array.from({ length: acc.count }, (_, k) => [0, 1, 2].map((c) => bin.readFloatLE(at + k * 12 + c * 4)))
      }
      const pos = read(prim.attributes.POSITION)
      const nrm = read(prim.attributes.NORMAL)
      const tops = new Map<number, number[][]>()
      pos.forEach((v, k) => {
        if (nrm[k][1] < 0.9 || v[1] < 0.2 || v[1] > 0.6) return
        const y = Math.round(v[1] * 1000) / 1000
        tops.set(y, [...(tops.get(y) ?? []), v])
      })
      const tiers = [...tops.entries()].sort(([a], [b]) => a - b)
      expect(tiers.map(([y]) => y)).toEqual(SEAT_TIERS.map((t) => t.y))
      tiers.forEach(([, vs], i) => {
        expect(Math.min(...vs.map((v) => v[2]))).toBeCloseTo(SEAT_TIERS[i].z[0], 3)
        expect(Math.max(...vs.map((v) => v[2]))).toBeCloseTo(SEAT_TIERS[i].z[1], 3)
        expect(Math.min(...vs.map((v) => v[0]))).toBeCloseTo(SEAT_X[0], 3)
        expect(Math.max(...vs.map((v) => v[0]))).toBeCloseTo(SEAT_X[1], 3)
      })
    })
  }
})
