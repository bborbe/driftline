import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Track } from '../track/schema'
import { createCarAt, FixedStepper, NO_INPUT, TICK_HZ, trackSurface } from '.'

const lap1 = JSON.parse(readFileSync(new URL('../../assets/track/test1.json', import.meta.url), 'utf8')) as Track

describe('spawn on lap1', () => {
  it('car at track.start with no input stays put for 2 s', () => {
    const sim = new FixedStepper(createCarAt(lap1.start), trackSurface(lap1))
    const start = sim.state.position
    for (let i = 0; i < 2 * TICK_HZ; i++) sim.advance(1 / TICK_HZ, NO_INPUT)
    expect(Math.abs(sim.state.position.x - start.x)).toBeLessThan(1e-3)
    expect(Math.abs(sim.state.position.z - start.z)).toBeLessThan(1e-3)
  })

  it('climbs the ramp under full throttle instead of passing through it', () => {
    const sim = new FixedStepper(createCarAt(lap1.start), trackSurface(lap1))
    let maxY = -Infinity
    for (let i = 0; i < 6 * TICK_HZ; i++) {
      sim.advance(1 / TICK_HZ, { ...NO_INPUT, throttle: 1 })
      maxY = Math.max(maxY, sim.state.position.y)
    }
    expect(maxY).toBeGreaterThan(3) // ramp rises 5.2 m
  })
})
