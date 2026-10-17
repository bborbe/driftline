import { describe, expect, it } from 'vitest'
import { createCar, createCarAt, dot, forwardOf, NO_INPUT, step, TICK_HZ, trackSurface, type CarInput, type CarState } from '../../physics'
import { CELL, ROAD_WIDTH } from '../../track/schema'
import { loadLap } from '../../track/registry'
import { ROAD_HALF_WIDTH, ROAD_TOP } from '../track/zones'
import { DECAL_LIFT } from '../track/curbs'
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

  it('persist after the drift and sit on the drawn surface as decals: asphalt top + 3 mm on the road, ground + 3 mm off it', () => {
    const track = loadLap('test-flat')
    const surface = trackSurface(track)
    const trail = new SkidTrail(surface)
    const go = (s: CarState, ticks: number, input: CarInput) => {
      for (let t = 0; t < ticks; t++) {
        s = step(s, input, surface)
        trail.update(s)
      }
      return s
    }
    // Down test-flat's 120 m start straight to ~15 m/s, then a handbrake flick that stays on the asphalt.
    let s = createCarAt(track.start)
    while (speedOf(s) < 15) s = step(s, { ...NO_INPUT, throttle: 1 }, surface)
    s = go(s, TICK_HZ / 2, { ...NO_INPUT, steer: 0.5, handbrake: true })
    const laid = trail.marks.map((m) => ({ ...m }))
    expect(laid.length).toBeGreaterThan(0)
    go(s, 200, NO_INPUT) // rolling on: every mark already laid is still there, unmoved
    expect(trail.marks.slice(0, laid.length)).toEqual(laid)
    const onRoad = laid.filter((m) => Math.abs(m.x) < ROAD_HALF_WIDTH * (ROAD_WIDTH / CELL))
    expect(onRoad.length).toBeGreaterThan(0)
    for (const m of onRoad) expect(m.y).toBeCloseTo(ROAD_TOP + DECAL_LIFT, 6)
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
