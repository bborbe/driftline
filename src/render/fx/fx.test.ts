import { describe, expect, it } from 'vitest'
import { createCar, dot, flatSurface, forwardOf, NO_INPUT, step, TICK_HZ, TURBO, type CarInput, type CarState } from '../../physics'
import { DECAL_LIFT } from '../track/curbs'
import { BOOST_FADE_S, boostStreakCount, MAX_BOOST_STREAKS } from './boost-streaks'
import { parseFx, pipelinePasses } from './flags'
import { SkidTrail } from './skid'
import { MAX_SMOKE, smokeIntensity, SmokePool } from './smoke'
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
    expect([...parseFx('?fx=smoke')]).toEqual(['smoke'])
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

  it('persist after the drift and sit on the road as decals (road top + 3 mm)', () => {
    const trail = new SkidTrail(flatSurface(0))
    const after = run(atSpeed(15), 2 * TICK_HZ, { ...NO_INPUT, steer: 1, handbrake: true }, (s) => trail.update(s))
    const laid = trail.marks.map((m) => ({ ...m }))
    expect(laid.length).toBeGreaterThan(0)
    run(after, 200, NO_INPUT, (s) => trail.update(s)) // rolling on: every mark already laid is still there, unmoved
    expect(trail.marks.slice(0, laid.length)).toEqual(laid)
    for (const m of trail.marks) expect(m.y).toBeCloseTo(DECAL_LIFT, 6)
  })
})

describe('drift smoke', () => {
  it('none when driving straight', () => {
    const pool = new SmokePool()
    run(createCar(), 4 * TICK_HZ, { ...NO_INPUT, throttle: 1 }, (s) => pool.update(s, 1 / TICK_HZ))
    expect(pool.emitted).toBe(0)
  })

  it('puffs during a handbrake turn, more at higher slip, bounded by the pool', () => {
    const pool = new SmokePool()
    let peak = 0
    run(atSpeed(15), 2 * TICK_HZ, { ...NO_INPUT, steer: 1, handbrake: true }, (s) => {
      peak = Math.max(peak, smokeIntensity(s))
      pool.update(s, 1 / TICK_HZ)
    })
    expect(pool.emitted).toBeGreaterThan(0)
    expect(peak).toBeGreaterThan(0)
    expect(pool.puffs.length).toBeLessThanOrEqual(MAX_SMOKE)
  })

  it('puffs fade out once the slide ends', () => {
    const pool = new SmokePool()
    const s = run(atSpeed(15), 2 * TICK_HZ, { ...NO_INPUT, steer: 1, handbrake: true }, (st) => pool.update(st, 1 / TICK_HZ))
    const still = { ...s, velocity: { x: 0, y: 0, z: 0 } }
    for (let i = 0; i < 2 * TICK_HZ; i++) pool.update(still, 1 / TICK_HZ)
    expect(pool.puffs.length).toBe(0)
  })
})

describe('frame stats', () => {
  it('ignores the warm-up frames (shader compilation on load)', () => {
    const st = new FrameStats(60, 3)
    st.push(0, 2) // a 2 s compile stall
    st.push(2000, 1)
    expect(st.count).toBe(0)
    st.push(2016, 1 / 60)
    expect(st.onePercentLow()).toBeCloseTo(60, 5)
  })

  it('1% low is the 1st percentile of per-frame fps', () => {
    const st = new FrameStats(60, 0)
    let t = 0
    for (let i = 0; i < 990; i++) st.push((t += 16), 1 / 60)
    for (let i = 0; i < 10; i++) st.push((t += 33), 1 / 30)
    expect(st.onePercentLow()).toBeCloseTo(30, 5)
    expect(st.average()).toBeGreaterThan(59)
  })

  it('forgets frames older than the 60 s window', () => {
    const st = new FrameStats(60, 0)
    st.push(0, 1 / 10)
    st.push(61_000, 1 / 60)
    expect(st.count).toBe(1)
    expect(st.onePercentLow()).toBeCloseTo(60, 5)
  })
})

describe('boost streaks', () => {
  const yellow = TURBO['turbo']
  const red = TURBO['turbo-red']

  it('show none without a boost', () => {
    expect(boostStreakCount(0, yellow.force)).toBe(0)
    expect(boostStreakCount(0, 0)).toBe(0)
  })

  it('show while a pad boost runs, more for the strong red pad', () => {
    const y = boostStreakCount(yellow.ticks, yellow.force)
    const r = boostStreakCount(red.ticks, red.force)
    expect(y).toBeGreaterThan(0)
    expect(r).toBe(MAX_BOOST_STREAKS)
    expect(r).toBeGreaterThan(y)
  })

  it('fade out over the last BOOST_FADE_S of the boost', () => {
    const full = boostStreakCount(yellow.ticks, yellow.force)
    const late = boostStreakCount(Math.round((BOOST_FADE_S * TICK_HZ) / 3), yellow.force)
    expect(late).toBeGreaterThan(0)
    expect(late).toBeLessThan(full)
    expect(boostStreakCount(1, yellow.force)).toBeGreaterThanOrEqual(1)
  })
})
