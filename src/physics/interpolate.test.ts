import { describe, expect, it } from 'vitest'
import { createCarAt, FixedStepper } from './car'
import { length, sub, type Vec3 } from './vec'

// Rendered per-frame displacement at constant speed should be constant; the spread
// (max/min step) is the visible judder: raw ticks at a non-100 Hz display alternate 1 and 2
// ticks per frame (or 0 and 1), the interpolated pose does not.
const spread = (hz: number, render: (s: FixedStepper) => Vec3): number => {
  const sim = new FixedStepper(createCarAt({ x: 0, y: 0, z: 0, heading: 0 }))
  const throttle = { throttle: 1, brake: 0, steer: 0, handbrake: false }
  for (let i = 0; i < 600; i++) sim.advance(1 / 100, throttle) // reach speed
  const steps: number[] = []
  let prev = render(sim)
  for (let f = 0; f < hz; f++) {
    sim.advance(1 / hz, throttle)
    const p = render(sim)
    steps.push(length(sub(p, prev)))
    prev = p
  }
  return Math.max(...steps) / Math.min(...steps)
}

describe('render judder', () => {
  for (const hz of [60, 120, 144]) {
    it(`raw state at ${hz} Hz`, () => {
      const r = spread(hz, (s) => s.state.position)
      console.info(`judder raw ${hz}Hz max/min step = ${r.toFixed(2)}`)
      expect(r).toBeGreaterThan(1.5) // documents the bug the interpolation fixes
    })
    it(`interpolated pose moves evenly at ${hz} Hz`, () => {
      const r = spread(hz, (s) => s.render().position)
      console.info(`judder interpolated ${hz}Hz max/min step = ${r.toFixed(3)}`)
      expect(r).toBeLessThan(1.05)
    })
  }
})

describe('interpolate', () => {
  it('snaps to state replaced outside advance (respawn)', () => {
    const sim = new FixedStepper(createCarAt({ x: 0, y: 0, z: 0, heading: 0 }))
    sim.advance(0.025, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    const respawn = createCarAt({ x: 50, y: 0, z: 50, heading: 1 })
    sim.state = respawn
    expect(sim.render()).toBe(respawn)
  })
})
