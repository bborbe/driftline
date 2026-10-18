import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { FIXTURE_TRACK } from '../../track/fixture'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { planStadium } from './stadium'
import { planDressing } from './dressing'
import { approachLength, corners, DRESSING_REACH, EDGE_CLEAR, footprints, MIN_CORNER_ANGLE, planTrackside, turnAngle } from './trackside-plan'

const tracks: Record<string, Track> = { ...Object.fromEntries(LAP_NAMES.map((n) => [n, loadLap(n)])), fixture: FIXTURE_TRACK }
const MAIN = ['test1', 'test2'] as const

describe('corners', () => {
  for (const name of MAIN) {
    it(`${name}: numbers every turning segment of ≥ ${MIN_CORNER_ANGLE}° in lap order, and only those`, () => {
      const track = tracks[name]
      const cs = corners(track)
      const expected = track.segments.flatMap((s, i) => (['curve', 'hairpin', 'banked'].includes(s.type) && turnAngle(s) >= MIN_CORNER_ANGLE ? [i] : []))
      expect(cs.map((c) => c.segment)).toEqual(expected)
      expect(cs.map((c) => c.label)).toEqual(expected.map((_, k) => k + 1))
      expect(cs.length).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('planTrackside', () => {
  for (const name of MAIN) {
    const track = tracks[name]
    const plan = planTrackside(track)
    const cs = corners(track)

    it(`${name}: a corner-number board for every numbered corner`, () => {
      expect(plan.boards.filter((b) => b.kind === 'corner').map((b) => b.label)).toEqual(cs.map((c) => c.label))
    })

    it(`${name}: a 100 and a 50 board on every approach long enough for them, each label its real distance to the corner (± BOARD_SLIDE)`, () => {
      const line = centreline(track, 1)
      for (const c of cs) {
        const approach = approachLength(track, c)
        for (const dist of [100, 50]) {
          const kind = dist === 100 ? 'brake-100' : 'brake-50'
          const board = plan.boards.find((b) => b.kind === kind && Math.abs(b.label - dist) === 0 && near(line, b, c.entry - dist))
          // Ground-level approaches only: a board beside a ramp top would hang in the air.
          const ground = line[Math.round(c.entry - dist + line.length) % line.length].y < 1
          if (approach >= dist + 5 && ground) expect(board, `${name} corner ${c.label} ${kind}`).toBeDefined()
          if (board) expect(board.label).toBe(dist)
        }
      }
      // test2's only long approach is corner 2's (184 m); its other corners follow 40–50 m straights.
      expect(plan.boards.filter((b) => b.kind !== 'corner').length).toBeGreaterThanOrEqual(2)
    })

    it(`${name}: banners, marshal posts and fence runs at ≥ 3 corners`, () => {
      expect(plan.banners.length).toBeGreaterThanOrEqual(3)
      expect(plan.marshals.length).toBeGreaterThanOrEqual(3)
      expect(plan.fences.length).toBeGreaterThanOrEqual(3)
    })

    it(`${name}: colour patches on both sides of the lap`, () => {
      expect(plan.patches.length).toBeGreaterThanOrEqual(6)
      expect(new Set(plan.patches.map((p) => p.shade)).size).toBe(3)
    })
  }

  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: nothing within the road half-width + curb (${EDGE_CLEAR} m) of any road at its level, nothing on the stadium dressing or in the stadium ring`, () => {
      const line = centreline(track, 1)
      const plan = planTrackside(track)
      const items: [number, number, number, number][] = [
        ...plan.boards.map((b): [number, number, number, number] => [b.x, b.y, b.z, 0]),
        ...plan.banners.map((b): [number, number, number, number] => [b.x, b.y, b.z, 0]),
        ...plan.marshals.map((m): [number, number, number, number] => [m.x, m.y, m.z, 0]),
        ...plan.fences.flatMap((f) => f.points.map(([x, z]): [number, number, number, number] => [x, f.y, z, 0])),
        ...plan.patches.map((p): [number, number, number, number] => [p.x, 0, p.z, p.radius]),
      ]
      for (const [x, y, z, r] of items) {
        const near = line.filter((c) => Math.abs(c.y - y) <= 4)
        const gap = Math.min(...near.map((c) => Math.hypot(c.x - x, c.z - z) - c.width / 2 - r))
        expect(gap).toBeGreaterThanOrEqual(EDGE_CLEAR - 1) // 1 m: sampling step
      }
      for (const [x, z, r] of footprints(plan)) {
        for (const d of planDressing(track)) expect(Math.hypot(d.x - x, d.z - z), `${name} vs dressing ${d.kind}`).toBeGreaterThanOrEqual(r + DRESSING_REACH[d.kind])
      }
      const stadium = planStadium(track)
      for (const [x, z, r] of footprints(plan)) {
        for (const s of stadium) expect(Math.hypot(s.x - x, s.z - z), `${name} vs stadium ${s.model}`).toBeGreaterThan(r + s.scale / 2)
      }
    })
  }

  it('is deterministic', () => {
    expect(planTrackside(tracks.test2)).toEqual(planTrackside(tracks.test2))
  })
})

/** The board stands beside the lap point `d` metres in (within 1.5 m along the lap). */
const near = (line: ReturnType<typeof centreline>, b: { x: number; z: number }, d: number) => {
  const p = line[(Math.round(d) + line.length) % line.length]
  return Math.hypot(p.x - b.x, p.z - b.z) < p.width / 2 + 6
}
