import { afterEach, describe, expect, it } from 'vitest'
import { createCar, dot, forwardOf, NO_INPUT, step, TICK_HZ, type CarInput, type CarState } from './index'
import {
  DEFAULT_HANDLING, handling, handlingFromJson, handlingToJson, HANDLING_KEYS, isTuned, materials, resetHandling, setHandling,
} from './handling'

const full: CarInput = { throttle: 1, brake: 0, steer: 0, handbrake: false }
const script = (t: number): CarInput => ({ throttle: t < 500 ? 1 : 0.4, brake: 0, steer: Math.sin(t / 40), handbrake: t >= 600 && t < 700 })
const run = (ticks: number, input: (t: number) => CarInput): CarState => {
  let s = createCar()
  for (let t = 0; t < TICK_HZ; t++) s = step(s, NO_INPUT)
  for (let t = 0; t < ticks; t++) s = step(s, input(t))
  return s
}
const speedOf = (s: CarState) => dot(s.velocity, forwardOf(s))

afterEach(() => resetHandling())

describe('live handling config', () => {
  it('starts at the defaults, untuned', () => {
    expect(handling()).toEqual(DEFAULT_HANDLING)
    expect(isTuned()).toBe(false)
  })

  it('a tuned top speed applies on the next tick, and a reset is bit-identical to never tuning', () => {
    const untouched = run(1000, script)
    setHandling({ ...DEFAULT_HANDLING, maxSpeed: 20 })
    expect(isTuned()).toBe(true)
    const capped = run(20 * TICK_HZ, () => full)
    expect(speedOf(capped)).toBeLessThan(23)
    resetHandling()
    expect(speedOf(run(20 * TICK_HZ, () => full))).toBeGreaterThan(35)
    expect(run(1000, script)).toEqual(untouched)
  })

  it('a value changed mid-run takes effect from that tick', () => {
    let s = run(0, () => full)
    for (let t = 0; t < 3 * TICK_HZ; t++) s = step(s, full)
    const before = s
    setHandling({ ...DEFAULT_HANDLING, engineForce: 0 })
    const next = step(before, full)
    resetHandling()
    expect(speedOf(next)).toBeLessThan(speedOf(step(before, full)))
  })

  it('surface multipliers feed the material table', () => {
    setHandling({ ...DEFAULT_HANDLING, iceGrip: 0.3, offroadMaxSpeed: 12 })
    expect(materials().ice.grip).toBe(0.3)
    expect(materials().offroad.maxSpeed).toBe(12)
    expect(materials().road).toEqual({ grip: 1, drag: 0 })
  })
})

describe('handling JSON', () => {
  it('round-trips a full tune', () => {
    const tune = { ...DEFAULT_HANDLING, maxSpeed: 47.5, driftKick: 9.2, gravity: 12 }
    expect(handlingFromJson(handlingToJson(tune))).toEqual(tune)
  })

  it('fills missing keys from the defaults and ignores unknown or non-numeric ones', () => {
    expect(handlingFromJson('{"grip": 2.1, "bogus": 3, "drag": "x"}')).toEqual({ ...DEFAULT_HANDLING, grip: 2.1 })
  })

  it('rejects text that is not a JSON object', () => {
    for (const t of ['', 'nope', '[1,2]', '42', 'null']) expect(handlingFromJson(t)).toBeNull()
  })

  it('every key is a finite number', () => {
    for (const k of HANDLING_KEYS) expect(Number.isFinite(DEFAULT_HANDLING[k])).toBe(true)
  })
})
