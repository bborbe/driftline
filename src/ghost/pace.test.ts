import { describe, expect, it } from 'vitest'
import { TICK_HZ } from '../physics'
import { LAP_NAMES, loadLap } from '../track/registry'
import { PaceGhost, recordPaceLap } from './pace'

const TICK_MS = 1000 / TICK_HZ

describe('medal pace ghosts', () => {
  it('every track with medals yields a finished autopilot pace lap', () => {
    const medal = LAP_NAMES.filter((n) => loadLap(n).medals)
    expect(medal.length).toBeGreaterThan(10)
    const failed = medal.filter((n) => recordPaceLap(loadLap(n)) === null)
    expect(failed).toEqual([])
  }, 120_000)

  it.each(['test2', 'glacier'])('%s: the gold and author ghosts reach the line at their medal times', (name) => {
    const track = loadLap(name)
    const lap = recordPaceLap(track)!
    const line = lap.states.at(-1)!.position
    for (const medal of ['gold', 'author'] as const) {
      const ms = track.medals![medal]
      const ghost = new PaceGhost(lap, ms)
      expect(ghost.lapMs).toBe(ms)
      // On the line at the medal time, still short of it one tick earlier.
      expect(ghost.at(ms / TICK_MS).position).toEqual(line)
      expect(ghost.at(ms / TICK_MS - 1).position).not.toEqual(line)
      // Splits scale with the lap: the same share of the medal time as of the autopilot's.
      ghost.splits.forEach((s, i) => expect(s / ms).toBeCloseTo(lap.splits[i] / lap.lapMs, 9))
      expect(ghost.splits.length).toBeGreaterThan(0)
    }
  })

  it('holds the grid before GO', () => {
    const lap = recordPaceLap(loadLap('test2'))!
    expect(new PaceGhost(lap, 38_000).at(-50)).toEqual(lap.states[0])
  })
})
