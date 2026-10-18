// Effect pads driven through the real race path (advanceRace → FixedStepper → step): each pad gates
// the input it should, reset / respawn / restart clear them, the ghost replays a run over every pad
// bit-identically, and a track without pads runs exactly as it did before the effects layer existed.
import { describe, expect, it } from 'vitest'
import {
  dot, DT, FixedStepper, forwardOf, length, NO_INPUT, sub, TICK_HZ, trackSurface, wheelContacts, type CarInput, type CarState,
} from '../physics'
import { GhostRecorder, GhostReplayer } from '../ghost'
import { EFFECT_KINDS, type EffectKind, type Track, type Zone } from '../track/schema'
import { EFFECT_LABEL } from '../render/track/effect-pads'
import { autopilot, centreline, loadTrack } from './autopilot.test-driver'
import { BROKEN_STEER, FRAGILE_IMPACT, SLOW_MO_SCALE, type ActiveEffect } from './effects'
import { effectChips } from './hud'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'

const THROTTLE: CarInput = { ...NO_INPUT, throttle: 1 }

// A long flat oval: pads on the 300 m start straight, so an effect has room to show.
const oval = (zones: Zone[], straight = 300): Track => ({
  name: 'fx-oval',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: [
    { type: 'straight', length: straight },
    { type: 'hairpin', turn: 'right', radius: 15 },
    { type: 'straight', length: straight },
    { type: 'hairpin', turn: 'right', radius: 15 },
  ],
  gates: [
    { kind: 'start-finish', segment: 0 },
    { kind: 'checkpoint', segment: 2 },
  ],
  zones,
})

const pad = (kind: EffectKind, from: number, to = from + 0.02): Zone => ({ kind, segment: 0, from, to })

/** Begin, countdown, then racing: the loop and sim at go. */
function race(track: Track) {
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  loop.start(sim.state.tick)
  for (let i = 0; i <= COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
  expect(loop.phase).toBe('racing')
  return { loop, sim }
}

/** Drive one tick at a time with `raw` until `until` holds (fails after 30 s). */
function driveUntil(loop: LapLoop, sim: FixedStepper, raw: (s: CarState) => CarInput, until: () => boolean): void {
  for (let i = 0; i < 30 * TICK_HZ; i++) {
    if (until()) return
    advanceRace(loop, sim, 1 / TICK_HZ, raw(sim.state))
  }
  throw new Error('condition never held')
}

const has = (loop: LapLoop, e: ActiveEffect) => loop.effects.active().includes(e)
const forwardSpeed = (s: CarState) => dot(s.velocity, forwardOf(s))

describe('no-steer pad', () => {
  it('locks the wheel straight: full steer input moves the car no further sideways than none', () => {
    const steerHard = (track: Track) => {
      const { loop, sim } = race(track)
      driveUntil(loop, sim, () => THROTTLE, () => sim.state.position.z > 32)
      const fed: CarInput[] = []
      const x0 = sim.state.position.x
      for (let i = 0; i < TICK_HZ; i++) {
        advanceRace(loop, sim, 1 / TICK_HZ, { ...THROTTLE, steer: 1 })
        fed.push(...sim.fed.map((f) => f.input))
      }
      return { loop, fed, dx: Math.abs(sim.state.position.x - x0) }
    }
    const locked = steerHard(oval([pad('no-steer', 0.1)]))
    expect(has(locked.loop, 'no-steer')).toBe(true)
    expect(locked.fed.every((i) => i.steer === 0)).toBe(true)
    expect(locked.dx).toBeLessThan(0.01)
    // Positive control: the same input without the pad turns the car.
    expect(steerHard(oval([])).dx).toBeGreaterThan(1)
  })
})

describe('engine-off pad', () => {
  it('cuts the throttle: held throttle feeds 0 and the car slows', () => {
    const { loop, sim } = race(oval([pad('engine-off', 0.1)]))
    driveUntil(loop, sim, () => THROTTLE, () => has(loop, 'engine-off'))
    const v0 = forwardSpeed(sim.state)
    for (let i = 0; i < TICK_HZ; i++) {
      advanceRace(loop, sim, 1 / TICK_HZ, THROTTLE)
      expect(sim.fed.every((f) => f.input.throttle === 0)).toBe(true)
    }
    expect(forwardSpeed(sim.state)).toBeLessThan(v0 - 1)
  })
})

describe('cruise pad', () => {
  it('holds the entry speed within ±0.5 m/s for 2 s against throttle and then brake', () => {
    const { loop, sim } = race(oval([pad('cruise', 0.1)]))
    driveUntil(loop, sim, () => THROTTLE, () => has(loop, 'cruise'))
    const locked = loop.effects.cruiseSpeed
    expect(locked).toBeGreaterThan(8)
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      advanceRace(loop, sim, 1 / TICK_HZ, i < TICK_HZ ? THROTTLE : { ...NO_INPUT, brake: 1 })
      expect(Math.abs(forwardSpeed(sim.state) - locked)).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('slow-motion pad', () => {
  it('halves the sim distance per tick while the lap timer still advances 10 ms per tick', () => {
    const { loop, sim } = race(oval([pad('slow-mo', 0.1)]))
    driveUntil(loop, sim, () => THROTTLE, () => has(loop, 'slow-mo'))
    for (let i = 0; i < 50; i++) {
      const before = sim.state
      const t0 = loop.lapTimeMs(before.tick)
      advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
      expect(sim.fed.map((f) => f.input.timeScale)).toEqual([SLOW_MO_SCALE])
      expect(loop.lapTimeMs(sim.state.tick) - t0).toBeCloseTo(10, 9)
      const moved = length(sub(sim.state.position, before.position))
      expect(moved / (length(sim.state.velocity) * DT)).toBeCloseTo(SLOW_MO_SCALE, 2)
    }
  })
})

describe('fragile pad', () => {
  // Up a ramp onto a 4 m deck, then off its end onto flat road: ~8.9 m/s into the ground, over FRAGILE_IMPACT.
  const ledge: Track = {
    name: 'fx-ledge',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [
      { type: 'straight', length: 20 },
      { type: 'ramp', length: 40, rise: 4 },
      { type: 'straight', length: 40 },
      { type: 'gap', length: 10, fall: 4 },
      { type: 'straight', length: 200 },
    ],
    // The checkpoint far down the run keeps the start arch from finishing the lap straight away.
    gates: [
      { kind: 'start-finish', segment: 0 },
      { kind: 'checkpoint', segment: 4 },
    ],
    zones: [{ kind: 'fragile', segment: 2, from: 0.3, to: 0.4 }],
  }

  it('breaks the car on a hard flat landing: steering and throttle cut', () => {
    expect(Math.sqrt(2 * 9.81 * 4)).toBeGreaterThan(FRAGILE_IMPACT)
    const { loop, sim } = race(ledge)
    driveUntil(loop, sim, () => THROTTLE, () => has(loop, 'fragile'))
    driveUntil(loop, sim, () => THROTTLE, () => wheelContacts(sim.state, sim.surface) === 0)
    driveUntil(loop, sim, () => THROTTLE, () => wheelContacts(sim.state, sim.surface) > 0)
    advanceRace(loop, sim, 1 / TICK_HZ, THROTTLE)
    expect(has(loop, 'broken')).toBe(true)
    advanceRace(loop, sim, 1 / TICK_HZ, { ...THROTTLE, steer: 1 })
    expect(sim.fed.map((f) => f.input.steer)).toEqual(sim.fed.map(() => BROKEN_STEER))
  })

  it('does not break on test-ramp’s tangent landing at autopilot pace', () => {
    const base = loadTrack('test-ramp')
    const track: Track = { ...base, zones: [{ kind: 'fragile', segment: 0, from: 0.3, to: 0.6 }] }
    const { loop, sim } = race(track)
    const drive = autopilot(centreline(track))
    let flew = false
    let landed = false
    for (let i = 0; i < 20 * TICK_HZ && !landed; i++) {
      advanceRace(loop, sim, 1 / TICK_HZ, drive(sim.state))
      const contacts = wheelContacts(sim.state, sim.surface)
      if (contacts === 0 && sim.state.position.y > 2) flew = true
      if (flew && contacts > 0) landed = true
    }
    expect(landed).toBe(true)
    for (let i = 0; i < TICK_HZ; i++) advanceRace(loop, sim, 1 / TICK_HZ, drive(sim.state))
    expect(loop.effects.fragile).toBe('armed')
  })
})

describe('clearing effects', () => {
  const armed = () => {
    const { loop, sim } = race(oval([pad('no-steer', 0.05), pad('slow-mo', 0.08), pad('reset', 0.2)]))
    driveUntil(loop, sim, () => THROTTLE, () => has(loop, 'slow-mo'))
    expect(loop.effects.active()).toEqual(['no-steer', 'slow-mo'])
    return { loop, sim }
  }

  it('a reset pad clears every active effect', () => {
    const { loop, sim } = armed()
    driveUntil(loop, sim, () => THROTTLE, () => sim.state.position.z > 62)
    expect(loop.effects.active()).toEqual([])
  })

  it('respawn (R) clears them', () => {
    const { loop, sim } = armed()
    sim.state = loop.respawn(sim.state.tick)
    expect(loop.effects.active()).toEqual([])
    advanceRace(loop, sim, 1 / TICK_HZ, { ...THROTTLE, steer: 1 })
    expect(sim.fed[0].input).toEqual({ ...THROTTLE, steer: 1 })
  })

  it('restart (Delete) clears them', () => {
    const { loop, sim } = armed()
    sim.state = loop.restart(sim.state.tick)
    expect(loop.effects.active()).toEqual([])
  })
})

describe('HUD indicator', () => {
  it('names each effect after the car is driven onto its pad on test-effects', () => {
    const track = loadTrack('test-effects')
    const kinds = (track.zones ?? []).map((z) => z.kind)
    expect([...kinds].sort()).toEqual([...EFFECT_KINDS].sort())
    const { loop, sim } = race(track)
    const drive = autopilot(centreline(track))
    const seen = new Set<string>()
    for (let i = 0; i < 20 * TICK_HZ && loop.phase === 'racing'; i++) {
      advanceRace(loop, sim, 1 / TICK_HZ, drive(sim.state))
      for (const c of effectChips(loop.effects.active())) seen.add(c.label)
    }
    for (const k of EFFECT_KINDS.filter((k) => k !== 'reset')) expect(seen).toContain(EFFECT_LABEL[k])
  })
})

describe('ghost determinism with effects', () => {
  it('a 2-lap run over every pad at 0.0167 s frames replays bit-identically from the recorded gated inputs', () => {
    const track = loadTrack('test-effects')
    const loop = new LapLoop(track, () => true, 2)
    const sim = new FixedStepper(loop.spawn(), trackSurface(track))
    const recorder = new GhostRecorder()
    loop.on(recorder.listener(() => sim.state))
    const atFinish = new Map<number, CarState>()
    loop.on({ lapFinish: (tick) => atFinish.set(tick, sim.state) })
    const fedAt = new Map<number, CarInput>()
    const drive = autopilot(centreline(track))
    const tickCounts = new Set<number>()
    loop.start(sim.state.tick)
    for (let f = 0; f < 60 * 60 && loop.phase !== 'finished'; f++) {
      advanceRace(loop, sim, 0.0167, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
      recorder.consume(sim.fed)
      tickCounts.add(sim.fed.length)
      for (const { tick, input } of sim.fed) fedAt.set(tick, input)
    }
    expect(loop.phase).toBe('finished')
    expect(tickCounts).toContain(1)
    expect(tickCounts).toContain(2)

    const best = recorder.best!
    expect(best).not.toBeNull()
    const end = best.start.tick + best.inputs.length
    expect(atFinish.has(end)).toBe(true)
    best.inputs.forEach((input, i) => expect(input).toEqual(fedAt.get(best.start.tick + i)))
    expect(best.inputs.some((i) => i.timeScale === SLOW_MO_SCALE)).toBe(true)
    expect(best.inputs.some((i) => i.steer === 0 && i.throttle === 0)).toBe(true)

    const replay = new GhostReplayer(best, sim.surface)
    while (!replay.done) replay.advance()
    expect(replay.state).toEqual(atFinish.get(end))
  })
})

describe('tracks without pads', () => {
  it('test2’s autopilot lap through the effects layer is bit-identical to plain per-frame input', () => {
    const track = loadTrack('test2')
    const run = (viaEffects: boolean) => {
      const loop = new LapLoop(track, () => true)
      const sim = new FixedStepper(loop.spawn(), trackSurface(track))
      const drive = autopilot(centreline(track))
      loop.start(sim.state.tick)
      for (let i = 0; i < COUNTDOWN_TICKS + 120 * TICK_HZ && loop.phase !== 'finished'; i++) {
        const raw = loop.phase === 'racing' ? drive(sim.state) : NO_INPUT
        if (viaEffects) advanceRace(loop, sim, 1 / TICK_HZ, raw)
        else {
          sim.advance(1 / TICK_HZ, loop.input(raw))
          const respawned = loop.update(sim.state, wheelContacts(sim.state, sim.surface))
          if (respawned) sim.state = respawned
        }
      }
      expect(loop.phase).toBe('finished')
      return sim.state
    }
    expect(run(true)).toEqual(run(false))
  })
})
