import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { FIXTURE_TRACK } from '../../track/fixture'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { GROUND_LEVEL, planSigns, SIGN_CLEARANCE } from './signs'

// Every shipped track (campaign, test and multi-level) plus the all-segment-types fixture.
const tracks: Record<string, Track> = { ...Object.fromEntries(LAP_NAMES.map((n) => [n, loadLap(n)])), fixture: FIXTURE_TRACK }

describe('planSigns', () => {
  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: no board within the clearance of any road at its level`, () => {
      const line = centreline(track, 1)
      for (const s of planSigns(track)) {
        const near = line.filter((c) => Math.abs(c.y - s.y) <= 4)
        const nearest = Math.min(...near.map((c) => Math.hypot(c.x - s.x, c.z - s.z)))
        expect(nearest).toBeGreaterThanOrEqual(SIGN_CLEARANCE - 1) // 1 m: sampling step
      }
    })
  }

  it('stands every board on ground-level road, never on a deck (tower, crossover)', () => {
    for (const name of ['tower', 'crossover']) {
      const signs = planSigns(tracks[name])
      expect(signs.length, name).toBeGreaterThan(0)
      // y is the road edge's height: a banked turn's raised outside stays well under a deck.
      for (const s of signs) expect(s.y, name).toBeLessThan(GROUND_LEVEL + 2)
    }
  })

  it('test2: chevrons both ways and a turbo board each side of both pads', () => {
    const kinds = planSigns(tracks.test2).map((s) => s.kind)
    expect(kinds).toContain('left')
    expect(kinds).toContain('right')
    expect(kinds.filter((k) => k === 'turbo')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'turbo-red')).toHaveLength(2)
  })

  it('puts a turn board on the outside of the turn, facing the oncoming car', () => {
    const track = {
      name: 't',
      start: { x: 0, y: 0, z: 0, heading: 0 },
      segments: [{ type: 'curve' as const, turn: 'left' as const, radius: 30, angle: 90 as const }],
      gates: [],
    }
    const [first] = planSigns(track)
    expect(first.kind).toBe('left')
    // A left turn from heading 0 bends toward +x (left of travel); the outside is -x.
    expect(first.x).toBeLessThan(0)
    expect(first.z).toBeCloseTo(0, 6)
    expect(Math.cos(first.heading)).toBeCloseTo(-1, 6) // faces back along -z, toward the car
  })
})
