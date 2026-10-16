import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exitPose, poses, type Pose, type Track } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'
import { planPieces } from './pieces'

const lap = JSON.parse(readFileSync('assets/track/lap1.json', 'utf8')) as Track
const near = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('piece placement', () => {
  it('maps every lap1 segment and gate to pieces', () => {
    const plan = planPieces(lap)
    expect(plan.procedural).toEqual([])
    expect(plan.proceduralGates).toEqual([])
  })

  it('places every referenced piece file that exists under assets/pieces', () => {
    for (const p of planPieces(lap).placements) {
      expect(() => readFileSync(`assets/pieces/${p.piece}.glb`), p.piece).not.toThrow()
    }
  })

  it('starts each mapped segment at its poses() entry', () => {
    const ps = poses(lap)
    const placed = planPieces(lap).placements
    lap.segments.forEach((seg, i) => {
      if (seg.type === 'drop') return
      expect(placed.some((p) => near(p.pose, ps[i]) < 0.01 && p.piece !== 'checkpoint'), `segment ${i}`).toBe(true)
    })
  })

  it('lays a drop as a reversed ramp from its exit edge', () => {
    const ps = poses(lap)
    const i = lap.segments.findIndex((s) => s.type === 'drop')
    const drop = planPieces(lap).placements.find((p) => p.piece === 'ramp' && near(p.pose, ps[i + 1]) < 0.01)
    expect(drop).toBeDefined()
    expect(drop!.pose.heading).toBeCloseTo(ps[i + 1].heading + Math.PI, 6)
  })

  it('tiles a 110 m straight into whole pieces that end on the exit pose', () => {
    const t: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0.3 }, segments: [{ type: 'straight', length: 110 }], gates: [] }
    const tiles = planPieces(t).placements
    expect(tiles.length).toBe(6)
    const last = tiles[tiles.length - 1]
    const len = 20 * last.scale[2]
    const end = { ...last.pose, x: last.pose.x + Math.sin(0.3) * len, z: last.pose.z + Math.cos(0.3) * len }
    expect(near(end, exitPose(t.start, t.segments[0]))).toBeLessThan(0.01)
  })

  it('mirrors corners for left turns and splits a hairpin into two', () => {
    const t: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'hairpin', turn: 'left', radius: 30 }], gates: [] }
    const corners = planPieces(t).placements
    expect(corners.map((c) => c.piece)).toEqual(['corner', 'corner'])
    expect(corners[0].scale).toEqual([-2, 1, 2])
  })

  it('falls back to procedural for a 45° curve', () => {
    const i = FIXTURE_TRACK.segments.findIndex((s) => s.type === 'curve' && s.angle === 45)
    expect(planPieces(FIXTURE_TRACK).procedural).toContain(i)
  })
})
