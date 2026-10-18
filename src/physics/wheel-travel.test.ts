// wheelTravel() reads each wheel's spring length off the real track surface for the car view; it
// is a query beside groundUnder(), never called by step().
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { centreline } from '../track/centreline'
import { resolveTrack } from '../track/kit'
import type { Track } from '../track/schema'
import { createCarAt, FixedStepper, NO_INPUT, TICK_HZ, trackSurface, wheelTravel } from '.'

const load = (name: string) =>
  resolveTrack(JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track

// The bump piece's crest on test-kit-all (kit.ts `bump`: 1 m up over a cell, 1 m down over the next).
const BUMP_CREST = { x: 0, z: 70 }
// Half the wheelbase (car.ts mounts at z = ±1.3): centred this far short of the crest, the front wheels sit on it.
const HALF_BASE = 1.3

const nearest = (track: Track, x: number, z: number) =>
  centreline(track, 0.1).reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a))

describe('wheelTravel', () => {
  const track = load('test-kit-all')
  const surface = trackSurface(track)

  it('reads the settled spring length on flat road, the same at every corner', () => {
    const sim = new FixedStepper(createCarAt(track.start), surface)
    for (let i = 0; i < 2 * TICK_HZ; i++) sim.advance(1 / TICK_HZ, NO_INPUT)
    const springs = wheelTravel(sim.state, surface)
    expect(springs).toHaveLength(4)
    for (const w of springs) {
      expect(w.length).toBeGreaterThan(0.35)
      expect(w.length).toBeLessThan(0.5)
      expect(w.length).toBeCloseTo(springs[0].length, 4)
    }
  })

  it('gives full droop to a wheel off the ground', () => {
    const s = createCarAt({ ...track.start, y: track.start.y + 5 })
    for (const w of wheelTravel(s, surface)) expect(w.length).toBe(0.5)
  })

  it('spreads front and rear by at least 5 cm on the bump crest', () => {
    const at = nearest(track, BUMP_CREST.x, BUMP_CREST.z - HALF_BASE)
    expect(Math.abs(at.z - (BUMP_CREST.z - HALF_BASE))).toBeLessThan(0.1)
    const springs = wheelTravel(createCarAt(at), surface)
    const mean = (front: boolean) => {
      const ws = springs.filter((w) => w.mount.z > 0 === front)
      return ws.reduce((a, w) => a + w.length, 0) / ws.length
    }
    // The front wheels ride up onto the crest (shorter spring) while the rear hang lower on the slope.
    expect(mean(false) - mean(true)).toBeGreaterThanOrEqual(0.05)
  })
})
