import { describe, expect, it } from 'vitest'
import { createCar, dot, forwardOf, MAX_REVERSE_SPEED, NO_INPUT, slipAngleDeg, step, TICK_HZ, type CarInput, type CarState } from './index'

const run = (s: CarState, ticks: number, input: CarInput | ((t: number) => CarInput)): CarState => {
  for (let t = 0; t < ticks; t++) s = step(s, typeof input === 'function' ? input(t) : input)
  return s
}
const speedOf = (s: CarState) => dot(s.velocity, forwardOf(s))
const settled = () => run(createCar(), TICK_HZ, NO_INPUT)

// Scripted sequence exercising throttle, steer, brake, handbrake.
const script = (t: number): CarInput => ({
  throttle: t < 500 ? 1 : t < 700 ? 0.5 : 0,
  brake: t >= 850 ? 1 : 0,
  steer: Math.sin(t / 40),
  handbrake: t >= 600 && t < 750,
})

describe('car physics', () => {
  it('is deterministic over 1000 ticks of scripted input', () => {
    let a = createCar()
    let travelled = 0
    for (let t = 0; t < 1000; t++) {
      const next = step(a, script(t))
      travelled += Math.hypot(next.position.x - a.position.x, next.position.z - a.position.z)
      a = next
    }
    const b = run(createCar(), 1000, script)
    expect(a.tick).toBe(1000)
    expect(a.position).toEqual(b.position)
    expect(a.velocity).toEqual(b.velocity)
    expect(a.orientation).toEqual(b.orientation)
    // Sanity: the script actually moved the car.
    expect(travelled).toBeGreaterThan(50)
  })

  it('settles on the plane at rest without drifting', () => {
    const s = settled()
    const later = run(s, 2 * TICK_HZ, NO_INPUT)
    expect(Math.abs(later.position.x - s.position.x)).toBeLessThan(1e-6)
    expect(Math.abs(later.position.z - s.position.z)).toBeLessThan(1e-6)
  })

  it('accelerates 0 to 20 m/s within 3 s of full throttle', () => {
    const s = run(settled(), 3 * TICK_HZ, { ...NO_INPUT, throttle: 1 })
    expect(speedOf(s)).toBeGreaterThanOrEqual(20)
  })

  it('coasts down from 20 m/s to below 5 m/s within 6 s when throttle is released', () => {
    let s = settled()
    while (speedOf(s) < 20) s = step(s, { ...NO_INPUT, throttle: 1 })
    let ticks = 0
    while (speedOf(s) >= 5 && ticks < 10 * TICK_HZ) {
      s = step(s, NO_INPUT)
      ticks++
    }
    expect(ticks / TICK_HZ).toBeLessThanOrEqual(6)
    // Coasts to a full stop, then stays put.
    s = run(s, 5 * TICK_HZ, NO_INPUT)
    expect(Math.abs(speedOf(s))).toBeLessThan(0.05)
  })

  it('brakes from 20 m/s to 0 within 30 m', () => {
    let s = settled()
    while (speedOf(s) < 20) s = step(s, { ...NO_INPUT, throttle: 1 })
    const start = s.position
    let ticks = 0
    while (speedOf(s) > 0.1 && ticks < 5 * TICK_HZ) {
      s = step(s, { ...NO_INPUT, brake: 1 })
      ticks++
    }
    expect(speedOf(s)).toBeLessThanOrEqual(0.1)
    expect(Math.hypot(s.position.x - start.x, s.position.z - start.z)).toBeLessThanOrEqual(30)
  })

  it('holding brake after a stop drives backwards', () => {
    let s = settled()
    while (speedOf(s) < 10) s = step(s, { ...NO_INPUT, throttle: 1 })
    let minSpeed = Infinity
    for (let t = 0; t < 6 * TICK_HZ; t++) {
      s = step(s, { ...NO_INPUT, brake: 1 })
      minSpeed = Math.min(minSpeed, speedOf(s))
    }
    expect(minSpeed).toBeLessThan(-3)
    expect(forwardOf(s).z).toBeGreaterThan(0.9) // still facing forward: reversing, not spun round
  })

  it('caps reverse speed at 10 m/s', () => {
    let minSpeed = Infinity
    let s = settled()
    for (let t = 0; t < 15 * TICK_HZ; t++) {
      s = step(s, { ...NO_INPUT, brake: 1 })
      minSpeed = Math.min(minSpeed, speedOf(s))
    }
    expect(minSpeed).toBeGreaterThanOrEqual(-MAX_REVERSE_SPEED - 0.5)
    expect(minSpeed).toBeLessThan(-MAX_REVERSE_SPEED + 1.5) // actually reaches near the cap
  })

  it('throttle while rolling backwards brakes before driving forward', () => {
    let s = run(settled(), 4 * TICK_HZ, { ...NO_INPUT, brake: 1 })
    const reverseSpeed = speedOf(s)
    expect(reverseSpeed).toBeLessThan(-3)
    // Braking (16 kN) beats coasting: the car stops much faster than it would on its own.
    let ticks = 0
    while (speedOf(s) < -0.1 && ticks < 5 * TICK_HZ) {
      s = step(s, { ...NO_INPUT, throttle: 1 })
      ticks++
    }
    expect(ticks / TICK_HZ).toBeLessThan(1.5)
    s = run(s, 2 * TICK_HZ, { ...NO_INPUT, throttle: 1 })
    expect(speedOf(s)).toBeGreaterThan(5)
  })

  it('steers: the heading turns under steer input', () => {
    let s = settled()
    while (speedOf(s) < 10) s = step(s, { ...NO_INPUT, throttle: 1 })
    s = run(s, TICK_HZ, { ...NO_INPUT, throttle: 0.3, steer: 1 })
    const f = forwardOf(s)
    expect(Math.abs(Math.atan2(f.x, f.z))).toBeGreaterThan(0.3)
  })

  // Driver's view: car faces +z with +y up, so the driver's left is +x.
  const headingAfterSteer = (steer: number) => {
    let s = settled()
    while (speedOf(s) < 10) s = step(s, { ...NO_INPUT, throttle: 1 })
    s = run(s, TICK_HZ, { ...NO_INPUT, throttle: 0.3, steer })
    const f = forwardOf(s)
    return { heading: f, travelX: s.position.x }
  }

  it('steer left (-1) yaws the car to the driver\'s left', () => {
    const { heading, travelX } = headingAfterSteer(-1)
    expect(heading.x).toBeGreaterThan(0.2)
    expect(travelX).toBeGreaterThan(0)
  })

  it('steer right (+1) yaws the car to the driver\'s right', () => {
    const { heading, travelX } = headingAfterSteer(1)
    expect(heading.x).toBeLessThan(-0.2)
    expect(travelX).toBeLessThan(0)
  })

  it('holds a full-throttle corner at 15 m/s without the handbrake (no power oversteer)', () => {
    for (const steer of [0.5, 1]) {
      let s = settled()
      while (speedOf(s) < 15) s = step(s, { ...NO_INPUT, throttle: 1 })
      let maxSlip = 0
      for (let t = 0; t < 3 * TICK_HZ; t++) {
        s = step(s, { ...NO_INPUT, throttle: 1, steer })
        maxSlip = Math.max(maxSlip, slipAngleDeg(s))
      }
      expect(maxSlip).toBeLessThan(15)
    }
  })

  it('drifts: slip angle exceeds 15 degrees under steer + handbrake at 15 m/s', () => {
    let s = settled()
    while (speedOf(s) < 15) s = step(s, { ...NO_INPUT, throttle: 1 })
    let maxSlip = 0
    for (let t = 0; t < 2 * TICK_HZ; t++) {
      s = step(s, { ...NO_INPUT, steer: 1, handbrake: true })
      maxSlip = Math.max(maxSlip, slipAngleDeg(s))
    }
    expect(maxSlip).toBeGreaterThan(15)
  })
})
