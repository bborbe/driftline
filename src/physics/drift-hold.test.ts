// Hold with steer (SC4 row 2, operator 2026-10-17: "Yes, hold while steering"): after a Space tap
// starts a slide at 90 km/h, keeping the steer into the turn holds it; straightening or
// countersteering ends it. At 870db41 the slide ended by itself ~0.7 s after the tap whatever
// the steer, so a driver could not choose when it ends.
import { describe, expect, it } from 'vitest'
import { createCar, forwardOf, NO_INPUT, slipAngleDeg, step, TICK_HZ, type CarState } from './index'

const speedOf = (s: CarState) => Math.hypot(s.velocity.x, s.velocity.z)

// 90 km/h on road, Space + full right for 0.25 s, then `steer` for `hold` s, then the exit:
// 'straight' (steer 0) or 'counter' (countersteer against the slip). Throttle on throughout.
function holdDrift(steer: number, hold: number, exit: 'straight' | 'counter') {
  let s = createCar()
  for (let t = 0; t < TICK_HZ; t++) s = step(s, NO_INPUT)
  while (speedOf(s) < 25) s = step(s, { ...NO_INPUT, throttle: 1 })
  const start = speedOf(s)
  const tap = 0.25
  let minHeld = Infinity
  let maxSlip = 0
  let ended = Infinity
  let heldSpeed = 0
  for (let t = 0; t < (tap + hold + 3) * TICK_HZ && ended === Infinity; t++) {
    const sec = t / TICK_HZ
    const f = forwardOf(s)
    const slip = (Math.sign(s.velocity.x * f.z - s.velocity.z * f.x) * slipAngleDeg(s) * Math.PI) / 180
    const out = sec >= tap + hold
    const input = sec < tap ? 1 : !out ? steer : exit === 'straight' ? 0 : Math.max(-1, Math.min(1, -2 * slip))
    s = step(s, { ...NO_INPUT, throttle: 1, steer: input, handbrake: sec < tap })
    maxSlip = Math.max(maxSlip, slipAngleDeg(s))
    if (!out && sec > tap + 0.3) minHeld = Math.min(minHeld, slipAngleDeg(s))
    if (!out) heldSpeed = speedOf(s)
    if (out && slipAngleDeg(s) < 8) ended = sec - tap - hold
  }
  return { minHeld, maxSlip, ended, kept: heldSpeed / start }
}

describe('speed drift: hold with steer', () => {
  it('full steer into the turn holds the slide for 2 s at 15-60° and keeps most of the speed', () => {
    const r = holdDrift(1, 2, 'straight')
    expect(r.minHeld).toBeGreaterThan(15)
    expect(r.maxSlip).toBeLessThan(60)
    expect(r.kept).toBeGreaterThan(0.8)
  })

  it('straightening ends the held slide within 0.6 s, countersteering within 0.8 s', () => {
    expect(holdDrift(1, 2, 'straight').ended).toBeLessThan(0.6)
    expect(holdDrift(1, 2, 'counter').ended).toBeLessThan(0.8)
  })

  it('a light steer does not hold it: the slide ends on its own', () => {
    expect(holdDrift(0.3, 2, 'straight').minHeld).toBeLessThan(10)
  })
})
