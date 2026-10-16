import { describe, expect, it } from 'vitest'
import { createCar, step, TICK_HZ, type CarInput, type CarState, type Vec3 } from '../physics'
import { GhostRecorder, GhostReplayer } from './ghost'

// Varied scripted lap: throttle, steering, brake, handbrake.
const script = (t: number): CarInput => ({
  throttle: t < 400 ? 1 : t < 600 ? 0.4 : 0.8,
  brake: t >= 700 && t < 760 ? 1 : 0,
  steer: Math.sin(t / 35),
  handbrake: t >= 500 && t < 560,
})
const steady = (): CarInput => ({ throttle: 1, brake: 0, steer: 0, handbrake: false })

// Drives a live lap through the recorder, returning the live position log.
const driveLap = (
  rec: GhostRecorder, start: CarState, ticks: number, lapTimeMs: number, isNewBest: boolean,
  input: (t: number) => CarInput = script,
): Vec3[] => {
  let car = start
  const log: Vec3[] = []
  rec.lapStart(car)
  for (let t = 0; t < ticks; t++) {
    const i = input(t)
    rec.record(i)
    car = step(car, i)
    log.push(car.position)
  }
  rec.lapFinish(lapTimeMs, isNewBest)
  return log
}

describe('ghost', () => {
  it('replays the live run bit-identically at every tick', () => {
    const rec = new GhostRecorder()
    const live = driveLap(rec, createCar(), 10 * TICK_HZ, 10_000, true)
    const replay = new GhostReplayer(rec.best!)
    const replayed: Vec3[] = []
    while (!replay.done) replayed.push(replay.advance().position)
    expect(replayed.length).toBe(live.length)
    expect(replayed).toEqual(live)
    // Sanity: the lap actually moved the car.
    const travelled = live.slice(1).reduce((d, p, i) => d + Math.hypot(p.x - live[i].x, p.z - live[i].z), 0)
    expect(travelled).toBeGreaterThan(50)
  })

  it('keeps the best lap, not the latest', () => {
    const rec = new GhostRecorder()
    driveLap(rec, createCar(), 6000, 60_000, true, steady)
    driveLap(rec, createCar(), 5500, 55_000, true)
    driveLap(rec, createCar(), 5800, 58_000, false, steady)
    expect(rec.best!.lapTimeMs).toBe(55_000)
    expect(rec.best!.inputs.length).toBe(5500)
    expect(rec.best!.inputs[0]).toEqual(script(0))
  })

  it('ignores inputs outside a lap', () => {
    const rec = new GhostRecorder()
    rec.record(script(0))
    rec.lapFinish(1000, true)
    expect(rec.best).toBeNull()
  })
})
