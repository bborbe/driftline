import { describe, expect, it } from 'vitest'
import { createCar, dot, forwardOf, NO_INPUT, step, TICK_HZ, type CarInput, type CarState } from '../../physics'
import { parseFx, pipelinePasses } from './flags'
import { SkidTrail } from './skid'
import { MAX_SPEEDLINES, speedLineCount } from './speedlines'
import { FrameStats } from './stats'

const run = (s: CarState, ticks: number, input: CarInput, each?: (s: CarState) => void) => {
  for (let t = 0; t < ticks; t++) {
    s = step(s, input)
    each?.(s)
  }
  return s
}
const speedOf = (s: CarState) => dot(s.velocity, forwardOf(s))
const atSpeed = (v: number) => {
  let s = run(createCar(), TICK_HZ, NO_INPUT)
  while (speedOf(s) < v) s = step(s, { ...NO_INPUT, throttle: 1 })
  return s
}

describe('?fx= flags', () => {
  it('parses known effects and ignores unknown ones', () => {
    expect([...parseFx('?fx=bloom,speedlines,skid')].sort()).toEqual(['bloom', 'skid', 'speedlines'])
    expect([...parseFx('?fx=skid,nope')]).toEqual(['skid'])
    expect(parseFx('').size).toBe(0)
  })

  it('bloom adds exactly one post pass', () => {
    expect(pipelinePasses(parseFx('?fx=bloom')).length).toBe(pipelinePasses(parseFx('')).length + 1)
  })
})

describe('speed lines', () => {
  it('none at rest or at 20 m/s, some above, capped at the maximum', () => {
    expect(speedLineCount(0)).toBe(0)
    expect(speedLineCount(20)).toBe(0)
    expect(speedLineCount(21)).toBeGreaterThan(0)
    expect(speedLineCount(-30)).toBeGreaterThan(0)
    expect(speedLineCount(200)).toBe(MAX_SPEEDLINES)
  })
})

describe('skid marks', () => {
  it('none when driving straight', () => {
    const trail = new SkidTrail()
    run(createCar(), 4 * TICK_HZ, { ...NO_INPUT, throttle: 1 }, (s) => trail.update(s))
    expect(trail.count).toBe(0)
  })

  it('appear after a scripted handbrake turn (slip > 15°)', () => {
    const trail = new SkidTrail()
    run(atSpeed(15), 2 * TICK_HZ, { ...NO_INPUT, steer: 1, handbrake: true }, (s) => trail.update(s))
    expect(trail.count).toBeGreaterThan(0)
  })
})

describe('frame stats', () => {
  it('1% low is the 1st percentile of per-frame fps', () => {
    const st = new FrameStats()
    let t = 0
    for (let i = 0; i < 990; i++) st.push((t += 16), 1 / 60)
    for (let i = 0; i < 10; i++) st.push((t += 33), 1 / 30)
    expect(st.onePercentLow()).toBeCloseTo(30, 5)
    expect(st.average()).toBeGreaterThan(59)
  })

  it('forgets frames older than the 60 s window', () => {
    const st = new FrameStats()
    st.push(0, 1 / 10)
    st.push(61_000, 1 / 60)
    expect(st.count).toBe(1)
    expect(st.onePercentLow()).toBeCloseTo(60, 5)
  })
})
