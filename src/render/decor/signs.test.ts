import { describe, expect, it } from 'vitest'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { FIXTURE_TRACK } from '../../track/fixture'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { PRE_PAD_DISTANCE, GROUND_LEVEL, planSigns, SIGN_CLEAR_EDGE } from './signs'

// Every shipped track (campaign, test and multi-level) plus the all-segment-types fixture.
const tracks: Record<string, Track> = { ...Object.fromEntries(LAP_NAMES.map((n) => [n, loadLap(n)])), fixture: FIXTURE_TRACK }

describe('planSigns', () => {
  for (const [name, track] of Object.entries(tracks)) {
    it(`${name}: no board within the clearance of any road at its level`, () => {
      const line = centreline(track, 1)
      for (const s of planSigns(track)) {
        const near = line.filter((c) => Math.abs(c.y - s.y) <= 4)
        // Past each road's own edge (its width there), not a default-width one.
        const nearest = Math.min(...near.map((c) => Math.hypot(c.x - s.x, c.z - s.z) - c.width / 2))
        expect(nearest).toBeGreaterThanOrEqual(SIGN_CLEAR_EDGE - 1) // 1 m: sampling step
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

  it('test2: chevrons both ways and a turbo board each side of both pads, beside and before them', () => {
    const kinds = planSigns(tracks.test2).map((s) => s.kind)
    expect(kinds).toContain('left')
    expect(kinds).toContain('right')
    expect(kinds.filter((k) => k === 'turbo')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'turbo-red')).toHaveLength(4)
  })

  it('stands a turbo board pair PRE_PAD_DISTANCE before the pad entry, facing the approaching car', () => {
    const zone = { kind: 'turbo' as const, segment: 0, from: 0.5, to: 0.6 }
    const track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'straight' as const, length: 100 }], gates: [], zones: [zone] }
    const before = planSigns(track).filter((s) => s.z < 50 - 1)
    expect(before).toHaveLength(2)
    for (const s of before) {
      expect(s.z).toBeCloseTo(50 - PRE_PAD_DISTANCE, 3)
      expect(Math.cos(s.heading)).toBeCloseTo(-1, 6) // the face looks back down -z, at the car
    }
    expect(Math.sign(before[0].x)).toBe(-Math.sign(before[1].x))
    // A reversed pad is entered from its far end, so its early pair stands past that end.
    const rev = planSigns({ ...track, zones: [{ ...zone, reverse: true }] }).filter((s) => s.z > 60 + 1)
    expect(rev).toHaveLength(2)
    for (const s of rev) expect(s.z).toBeCloseTo(60 + PRE_PAD_DISTANCE, 3)
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
