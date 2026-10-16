import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exitPose, poses, type Pose, type Track } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'
import { TRACK_WIDTH } from './geometry'
import { placedRoadWidth, planPieces } from './pieces'

const lap = JSON.parse(readFileSync('assets/track/lap1.json', 'utf8')) as Track
const near = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('piece placement', () => {
  it('renders a road for every lap1 segment: a road piece placed at it, or the procedural mesh', () => {
    const ps = poses(lap)
    const plan = planPieces(lap)
    const road = new Set(['straight', 'start', 'corner', 'ramp'])
    lap.segments.forEach((seg, i) => {
      const at = seg.type === 'drop' ? ps[i + 1] : ps[i]
      const piece = plan.placements.some((p) => road.has(p.piece) && near(p.pose, at) < 0.01)
      expect(piece || plan.procedural.includes(i), `segment ${i} (${seg.type}) has no road`).toBe(true)
    })
  })

  it('renders banked turns procedurally (banked.glb has no material or normals)', () => {
    const i = lap.segments.findIndex((s) => s.type === 'banked')
    expect(planPieces(lap).procedural).toContain(i)
  })

  it('places every referenced piece file that exists under assets/pieces', () => {
    for (const p of planPieces(lap).placements) {
      expect(() => readFileSync(`assets/pieces/${p.piece}.glb`), p.piece).not.toThrow()
    }
  })

  it('starts each mapped segment at its poses() entry', () => {
    const ps = poses(lap)
    const plan = planPieces(lap)
    const placed = plan.placements
    lap.segments.forEach((seg, i) => {
      if (seg.type === 'drop' || plan.procedural.includes(i)) return
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
    const t: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'hairpin', turn: 'left', radius: 15 }], gates: [] }
    const corners = planPieces(t).placements
    expect(corners.map((c) => c.piece)).toEqual(['corner', 'corner'])
    expect(corners[0].scale).toEqual([-1, 1, 1])
  })

  it('renders a non-native corner radius procedurally instead of scaling the road wider', () => {
    const t: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'curve', turn: 'right', radius: 30, angle: 90 }], gates: [] }
    expect(planPieces(t).procedural).toEqual([0])
  })

  for (const name of ['lap1', 'lap2']) {
    it(`${name}: road width is the same on both sides of every segment joint`, () => {
      const t = JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as Track
      const plan = planPieces(t)
      // Every road piece and every procedural segment draws the same width, so both sides
      // of every joint match.
      for (const p of plan.placements.filter((p) => p.piece !== 'checkpoint')) {
        expect(placedRoadWidth(p), `${name} ${p.piece} at (${p.pose.x.toFixed(1)}, ${p.pose.z.toFixed(1)})`).toBeCloseTo(TRACK_WIDTH, 6)
      }
      expect(plan.procedural.every((i) => i >= 0 && i < t.segments.length)).toBe(true)
    })
  }

  it('falls back to procedural for a 45° curve', () => {
    const i = FIXTURE_TRACK.segments.findIndex((s) => s.type === 'curve' && s.angle === 45)
    expect(planPieces(FIXTURE_TRACK).procedural).toContain(i)
  })
})
