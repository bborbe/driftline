// Speed drift on a real track (test-flat): a 0.4 s handbrake tap at 90 km/h on the 10 m straight
// slides the car sideways off the road. On the offroad ground the slide must still not spin
// (live run at 8f52e10: the spin guard was road-only and the car spun to 178° and stopped).
import { describe, expect, it } from 'vitest'
import { createCarAt, dot, forwardOf, materialUnder, NO_INPUT, slipAngleDeg, step, TICK_HZ, trackSurface, type CarState } from '../physics'
import { poses } from '../track/schema'
import { loadTrack } from './autopilot.test-driver'

describe('speed drift on test-flat', () => {
  it('a 0.4 s tap that slides off the road does not spin, and the car straightens up', () => {
    const track = loadTrack('test-flat')
    const surface = trackSurface(track)
    let s: CarState = createCarAt(poses(track)[0])
    for (let t = 0; t < TICK_HZ; t++) s = step(s, NO_INPUT, surface)
    while (dot(s.velocity, forwardOf(s)) < 25) s = step(s, { ...NO_INPUT, throttle: 1 }, surface)
    let maxSlip = 0
    let offroad = false
    let straight = -1
    for (let t = 0; t < 4 * TICK_HZ && straight < 0; t++) {
      const hb = t < 0.4 * TICK_HZ
      // Full right on the handbrake, then full countersteer while the slide lasts (keyboard driver).
      s = step(s, { ...NO_INPUT, throttle: 1, steer: hb ? 1 : slipAngleDeg(s) > 8 ? -1 : 0, handbrake: hb }, surface)
      if (materialUnder(s, surface) === 'offroad') offroad = true
      if (Math.hypot(s.velocity.x, s.velocity.z) > 5) maxSlip = Math.max(maxSlip, slipAngleDeg(s))
      if (!hb && maxSlip > 15 && slipAngleDeg(s) < 8) straight = t / TICK_HZ
    }
    expect(offroad).toBe(true) // the scenario: the slide does reach the offroad ground
    expect(maxSlip).toBeLessThan(60)
    expect(straight).toBeGreaterThan(0)
  })
})
