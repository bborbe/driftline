import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exitPose, poses, ROAD_WIDTH, widthAt, type Pose, type Track } from '../../track/schema'
import { FIXTURE_TRACK } from '../../track/fixture'
import { placedRoadWidth, planPieces } from './kenney-plan'

const lap = JSON.parse(readFileSync('assets/track/test1.json', 'utf8')) as Track
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

  it('renders ramps and drops procedurally, on the linear profile physics drives', () => {
    const plan = planPieces(lap)
    lap.segments.forEach((s, i) => {
      if (s.type === 'ramp' || s.type === 'drop') expect(plan.procedural, `segment ${i}`).toContain(i)
    })
    expect(plan.placements.some((p) => p.piece === 'ramp')).toBe(false)
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
    const t: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'hairpin', turn: 'left', radius: 15, width: 10 }], gates: [] }
    const corners = planPieces(t).placements
    expect(corners.map((c) => c.piece)).toEqual(['corner', 'corner'])
    expect(corners[0].scale).toEqual([-1, 1, 1])
  })

  it('stretches a straight across to its road width, and draws a corner or a taper wider than the piece procedurally', () => {
    const at = (segments: Track['segments']) => planPieces({ name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments, gates: [] })
    const wide = at([{ type: 'straight', length: 20, width: 20 }])
    expect(wide.placements.map(placedRoadWidth)).toEqual([20])
    expect(at([{ type: 'straight', length: 20 }]).placements.map(placedRoadWidth)).toEqual([ROAD_WIDTH])
    expect(at([{ type: 'straight', length: 20, width: [14, 20] }]).procedural).toEqual([0])
    expect(at([{ type: 'hairpin', turn: 'left', radius: 15 }]).procedural).toEqual([0])
  })

  it('renders a non-native corner radius procedurally instead of scaling the road wider', () => {
    const t: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'curve', turn: 'right', radius: 30, angle: 90 }], gates: [] }
    expect(planPieces(t).procedural).toEqual([0])
  })

  for (const name of ['test1', 'test2']) {
    it(`${name}: road width is the same on both sides of every segment joint`, () => {
      const t = JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as Track
      const plan = planPieces(t)
      const ps = poses(t)
      // A width change is a taper inside a segment (widthAt), never a step at a joint; a gap has no road.
      t.segments.forEach((seg, i) => {
        const next = t.segments[(i + 1) % t.segments.length]
        if (seg.type === 'gap' || next.type === 'gap') return
        expect(widthAt(next, 0), `${name} joint ${i} → ${i + 1}`).toBeCloseTo(widthAt(seg, 1), 6)
      })
      // Every road piece draws its own segment's width, so it meets the procedural road beside it.
      t.segments.forEach((seg, i) => {
        if (plan.procedural.includes(i)) return
        for (const p of planPieces({ ...t, start: ps[i], segments: [seg], gates: [] }).placements) {
          expect(placedRoadWidth(p), `${name} ${p.piece} on segment ${i}`).toBeCloseTo(widthAt(seg, 0), 6)
        }
      })
      expect(plan.procedural.every((i) => i >= 0 && i < t.segments.length)).toBe(true)
    })
  }

  it('falls back to procedural for a 45° curve', () => {
    const i = FIXTURE_TRACK.segments.findIndex((s) => s.type === 'curve' && s.angle === 45)
    expect(planPieces(FIXTURE_TRACK).procedural).toContain(i)
  })
})
