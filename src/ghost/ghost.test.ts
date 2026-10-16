import { describe, expect, it } from 'vitest'
import { createCar, FixedStepper, step, TICK_HZ, type CarInput, type CarState, type Vec3 } from '../physics'
import { GhostRecorder, GhostReplayer } from './ghost'

// Varied scripted lap: throttle, steering, brake, handbrake.
const script = (t: number): CarInput => ({
  throttle: t < 400 ? 1 : t < 600 ? 0.4 : 0.8,
  brake: t >= 700 && t < 760 ? 1 : 0,
  steer: Math.sin(t / 35),
  handbrake: t >= 500 && t < 560,
})
const steady = (): CarInput => ({ throttle: 1, brake: 0, steer: 0, handbrake: false })

// Drives a live lap tick by tick through the recorder, returning the live position log.
const driveLap = (
  rec: GhostRecorder, start: CarState, ticks: number, lapTimeMs: number,
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
  rec.lapFinish(car.tick, lapTimeMs)
  return log
}

const replayAll = (rec: GhostRecorder): Vec3[] => {
  const replay = new GhostReplayer(rec.best!)
  const out: Vec3[] = []
  while (!replay.done) out.push(replay.advance().position)
  return out
}

const travelled = (log: Vec3[]) => log.slice(1).reduce((d, p, i) => d + Math.hypot(p.x - log[i].x, p.z - log[i].z), 0)

describe('ghost', () => {
  it('replays the live run bit-identically at every tick', () => {
    const rec = new GhostRecorder()
    const live = driveLap(rec, createCar(), 10 * TICK_HZ, 10_000)
    const replayed = replayAll(rec)
    expect(replayed.length).toBe(live.length)
    expect(replayed).toEqual(live)
    expect(travelled(live)).toBeGreaterThan(50) // sanity: the lap actually moved the car
  })

  it('keeps the session\'s fastest lap, not the latest', () => {
    const rec = new GhostRecorder()
    driveLap(rec, createCar(), 6000, 60_000, steady)
    driveLap(rec, createCar(), 5500, 55_000)
    driveLap(rec, createCar(), 5800, 58_000, steady)
    expect(rec.best!.lapTimeMs).toBe(55_000)
    expect(rec.best!.inputs.length).toBe(5500)
    expect(rec.best!.inputs[0]).toEqual(script(0))
  })

  it('records per frame like the race loop, with lap events fired mid-frame', () => {
    const rec = new GhostRecorder()
    const sim = new FixedStepper(createCar())
    const events = rec.listener(() => sim.state)
    const startTick = 37
    let finishTick = 0
    let frameNo = 0
    while (finishTick === 0) {
      const input = script(frameNo++)
      const before = sim.state.tick
      // Like race.frame: one input for the whole frame, events after the advance.
      sim.advance(0.017 + (frameNo % 3) * 0.004, input)
      if (before < startTick && sim.state.tick >= startTick) events.lapStart!(sim.state.tick)
      else if (before >= startTick && sim.state.tick >= startTick + 800) {
        finishTick = sim.state.tick
        events.lapFinish!(finishTick, 8000, true)
      }
      rec.frame(input, sim.state.tick)
    }
    const run = rec.best!
    expect(run.start.tick).toBeGreaterThanOrEqual(startTick)
    expect(run.start.tick + run.inputs.length).toBe(finishTick)
    // Replay lands exactly where the live car ended.
    const replay = new GhostReplayer(run)
    expect(replay.advanceTo(run.inputs.length).position).toEqual(sim.state.position)
  })

  it('a lap with a pause in it replays bit-identically', () => {
    const rec = new GhostRecorder()
    const sim = new FixedStepper(createCar())
    const events = rec.listener(() => sim.state)
    events.lapStart!(sim.state.tick)
    let frameNo = 0
    const ghost = (): GhostReplayer | null => (rec.best ? new GhostReplayer(rec.best) : null)
    while (sim.state.tick < 800) {
      const input = script(frameNo++)
      // Frames 200-499 are paused: race.frame skips the advance, so the tick stands still.
      if (frameNo < 200 || frameNo >= 500) sim.advance(0.017 + (frameNo % 3) * 0.004, input)
      rec.frame(input, sim.state.tick)
    }
    events.lapFinish!(sim.state.tick, 8000, true)
    expect(rec.best!.inputs.length).toBe(sim.state.tick)
    expect(ghost()!.advanceTo(rec.best!.inputs.length).position).toEqual(sim.state.position)
  })

  it('keeps a ghost even when the race says the lap is not a new all-time best', () => {
    const rec = new GhostRecorder()
    const events = rec.listener(() => createCar())
    events.lapStart!(0)
    rec.frame(steady(), 300)
    events.lapFinish!(300, 70_000, false) // persisted record from an earlier session is faster
    rec.frame(steady(), 300)
    expect(rec.best!.lapTimeMs).toBe(70_000)
    expect(rec.best!.inputs.length).toBe(300)
  })

  it('drops a lap that had a respawn', () => {
    const rec = new GhostRecorder()
    const events = rec.listener(() => createCar())
    events.lapStart!(0)
    rec.frame(steady(), 100)
    events.respawn!(100)
    rec.frame(steady(), 200)
    events.lapFinish!(200, 2000, true)
    expect(rec.best).toBeNull()
  })

  it('ignores inputs outside a lap', () => {
    const rec = new GhostRecorder()
    rec.record(script(0))
    rec.lapFinish(1, 1000)
    expect(rec.best).toBeNull()
  })
})

describe('ghost on restart', () => {
  it('a fresh replayer of a finished run snaps to the start pose and holds it through the countdown', () => {
    const rec = new GhostRecorder()
    const start = createCar()
    driveLap(rec, start, 300, 3000)
    const old = new GhostReplayer(rec.best!)
    old.advanceTo(10_000) // finished lap: ghost parked at its last pose, far from the start
    expect(old.render(0.5).position).not.toEqual(start.position)
    // Restart (main.ts): new replayer, lapStartTick = +Infinity until the countdown ends.
    const ghost = new GhostReplayer(rec.best!)
    for (const alpha of [0, 0.5, 1]) {
      ghost.advanceTo(-Infinity)
      expect(ghost.render(alpha).position).toEqual(start.position)
    }
  })
})
