import { describe, expect, it } from 'vitest'
import { createCar, createCarAt, NO_INPUT, step, TICK_HZ, trackSurface, v3, type CarState } from '../../physics'
import type { Pillar } from '../../track/schema'
import { loadLap } from '../../track/registry'
import { DriftCue, DRIFT_CUE_MAX_DEG, DRIFT_CUE_MIN_DEG, DRIFT_CUE_MIN_SPEED, inDriftBand } from './drift-cue'
import { barrierContact, MAX_SPARKS, SparkPool, type Contact } from './sparks'

const DT = 1 / TICK_HZ

// A 40 m wall along +z at x = 2, 1 m thick; its inner face is x = 1.5.
const WALL: Pillar[] = [{ x: 2, y: 0, z: 0, heading: 0, halfWidth: 0.5, halfDepth: 20, height: 1 }]

/** A car on the ground at `x`, nose along +z, moving at `vz` along the wall (and `vx` into it). */
const carAt = (x: number, vz: number, vx = 0): CarState => ({ ...createCar(v3(x, 0.68, 0)), velocity: v3(vx, 0, vz) })

/** A car moving at `speed` m/s with `slipDeg` between its nose (+z) and its velocity. */
const sliding = (speed: number, slipDeg: number): CarState => {
  const a = (slipDeg * Math.PI) / 180
  return { ...createCar(v3(0, 0.68, 0)), velocity: v3(Math.sin(a) * speed, 0, Math.cos(a) * speed) }
}

describe('barrier sparks', () => {
  it('a car scraping the wall throws sparks; the same car clear of it, or with no obstacles, throws none', () => {
    // Physics pushes the body out to its 0.9 m capsule radius: touching the 1.5 m face puts the centre at x = 0.6.
    const touching = carAt(0.6, 15)
    const scraping = new SparkPool()
    for (let t = 0; t < 10; t++) scraping.update(touching, WALL, DT)
    expect(scraping.emitted).toBeGreaterThanOrEqual(1)

    const clear = new SparkPool()
    for (let t = 0; t < 10; t++) clear.update(carAt(-1, 15), WALL, DT)
    expect(clear.emitted).toBe(0)

    const none = new SparkPool()
    for (let t = 0; t < 10; t++) none.update(touching, undefined, DT)
    expect(none.emitted).toBe(0)
  })

  it('reports the contact on the wall face with the normal pointing out of the wall', () => {
    const c: Contact = { x: 0, y: 0, z: 0, nx: 0, nz: 0 }
    expect(barrierContact(carAt(0.6, 15), WALL, c)).not.toBeNull()
    expect(c.x).toBeCloseTo(1.5, 6)
    expect(c.nx).toBeCloseTo(-1, 6)
    expect(c.nz).toBeCloseTo(0, 6)
  })

  it('a slow touch throws none', () => {
    const pool = new SparkPool()
    for (let t = 0; t < 50; t++) pool.update(carAt(0.6, 2), WALL, DT)
    expect(pool.emitted).toBe(0)
  })

  it('the pool never grows: same length and the same spark objects over 10 000 scraping frames', () => {
    const pool = new SparkPool()
    const before = [...pool.sparks]
    for (let t = 0; t < 10_000; t++) pool.update(carAt(0.6, 25), WALL, DT)
    expect(pool.emitted).toBeGreaterThan(MAX_SPARKS) // the ring buffer wrapped many times
    expect(pool.sparks.length).toBe(MAX_SPARKS)
    expect(pool.sparks.every((p, i) => p === before[i])).toBe(true)
    expect(pool.alive).toBeLessThanOrEqual(MAX_SPARKS)
  })

  it('sparks on the real path: physics drives the car into test-flat\'s edge rail', () => {
    const track = loadLap('test-flat')
    const surface = trackSurface(track)
    const pool = new SparkPool()
    let s = createCarAt(track.start)
    for (let t = 0; t < 2 * TICK_HZ; t++) s = step(s, { ...NO_INPUT, throttle: 1 }, surface)
    // Full throttle with a gentle steer: the car runs into the rail and scrapes along it.
    for (let t = 0; t < 4 * TICK_HZ; t++) {
      s = step(s, { ...NO_INPUT, throttle: 1, steer: 0.35 }, surface)
      pool.update(s, surface.obstacles, DT)
    }
    expect(pool.emitted).toBeGreaterThan(0)
  })
})

describe('drift cue', () => {
  it(`is on from ${DRIFT_CUE_MIN_DEG}° to ${DRIFT_CUE_MAX_DEG}° of slip at ${DRIFT_CUE_MIN_SPEED} m/s and up, off at 5° and at 50°`, () => {
    for (const deg of [15.1, 25, 34.9]) expect(inDriftBand(sliding(20, deg)), `${deg}°`).toBe(true)
    expect(inDriftBand(sliding(10.1, 25))).toBe(true)
    expect(inDriftBand(sliding(20, 5))).toBe(false)
    expect(inDriftBand(sliding(20, 50))).toBe(false)
  })

  it('is off below the minimum speed, even at a good angle', () => {
    expect(inDriftBand(sliding(8, 25))).toBe(false)
  })

  it('fades in while held and back out to 0 after', () => {
    const cue = new DriftCue()
    for (let t = 0; t < TICK_HZ; t++) cue.update(sliding(20, 25), DT)
    expect(cue.level).toBeGreaterThan(0.95)
    for (let t = 0; t < 3 * TICK_HZ; t++) cue.update(sliding(20, 0), DT)
    expect(cue.level).toBe(0)
  })

  it('stays off driving straight down a lap', () => {
    const track = loadLap('test-flat')
    const surface = trackSurface(track)
    const cue = new DriftCue()
    let s = createCarAt(track.start)
    let peak = 0
    for (let t = 0; t < 3 * TICK_HZ; t++) {
      s = step(s, { ...NO_INPUT, throttle: 1 }, surface)
      peak = Math.max(peak, cue.update(s, DT))
    }
    expect(peak).toBe(0)
  })
})
