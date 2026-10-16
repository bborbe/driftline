import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Track } from '../track/schema'
import { createCarAt, FixedStepper, NO_INPUT, TICK_HZ, trackSurface, wheelContacts } from '.'

const lap1 = JSON.parse(readFileSync(new URL('../../assets/track/test1.json', import.meta.url), 'utf8')) as Track
const GROUND_Y = 0

describe('landing after the lap1 ramp', () => {
  it('lands and stays on or above the ground for 5 s', () => {
    const surface = trackSurface(lap1, { groundY: GROUND_Y })
    const sim = new FixedStepper(createCarAt(lap1.start), surface)
    let airborne = false
    let landedAt = -1
    let maxY = -Infinity
    for (let i = 0; i < 20 * TICK_HZ && landedAt < 0; i++) {
      sim.advance(1 / TICK_HZ, { ...NO_INPUT, throttle: 1 })
      maxY = Math.max(maxY, sim.state.position.y)
      const contacts = wheelContacts(sim.state, surface)
      if (contacts === 0 && sim.state.position.y > 3) airborne = true
      if (airborne && contacts > 0) landedAt = i
    }
    expect(maxY).toBeGreaterThan(3)
    expect(landedAt).toBeGreaterThan(0)
    let minY = Infinity
    for (let i = 0; i < 5 * TICK_HZ; i++) {
      sim.advance(1 / TICK_HZ, NO_INPUT)
      minY = Math.min(minY, sim.state.position.y)
    }
    expect(minY).toBeGreaterThanOrEqual(GROUND_Y - 0.1)
  })
})
