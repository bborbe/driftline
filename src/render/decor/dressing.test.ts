import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import { LAP_NAMES, loadLap } from '../../track/registry'
import type { Track } from '../../track/schema'
import { CLEAR_EDGE, planDressing, START_REACH, straightRuns } from './dressing'

const VENUES = ['flatout', 'glacier', 'showcase']

const nearestRoad = (track: Track, x: number, z: number) => {
  const line = centreline(track, 1)
  return Math.min(...line.filter((c) => Math.abs(c.y) < 4).map((c) => Math.hypot(c.x - x, c.z - z) - c.width / 2))
}

describe('planDressing', () => {
  for (const name of VENUES) {
    it(`${name}: a flag row along a straight, two totems and a start screen near the start`, () => {
      const track = loadLap(name)
      const props = planDressing(track)
      expect(straightRuns(track).length, 'long straights').toBeGreaterThanOrEqual(1)
      expect(props.filter((p) => p.kind === 'flag').length).toBeGreaterThanOrEqual(4)
      const start = track.start
      const near = (kind: string) => props.filter((p) => p.kind === kind && Math.hypot(p.x - start.x, p.z - start.z) <= START_REACH)
      expect(near('totem').length).toBeGreaterThanOrEqual(2)
      expect(near('startScreen').length).toBeGreaterThanOrEqual(1)
    })
  }

  for (const name of LAP_NAMES) {
    it(`${name}: every prop stands clear of every road at its level, flags behind the rail`, () => {
      const track = loadLap(name)
      for (const p of planDressing(track)) {
        const gap = nearestRoad(track, p.x, p.z)
        expect(gap, `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeGreaterThanOrEqual(CLEAR_EDGE - 0.01)
      }
    })
  }

  it('flags only on straights: a lap of turns has no flag row', () => {
    const turns: Track = { ...loadLap('test1'), segments: Array.from({ length: 4 }, () => ({ type: 'curve' as const, turn: 'left' as const, radius: 40, angle: 90 as const })) }
    expect(straightRuns(turns)).toEqual([])
    expect(planDressing(turns).filter((p) => p.kind === 'flag')).toEqual([])
  })

  it('a short straight carries no flag row', () => {
    const short: Track = { ...loadLap('test1'), segments: [{ type: 'straight', length: 20 }, { type: 'curve', turn: 'left', radius: 40, angle: 90 }] }
    expect(straightRuns(short)).toEqual([])
  })
})
