import { describe, expect, it } from 'vitest'
import { TICK_HZ, v3, type CarState } from '../physics'
import { poses } from '../track/schema'
import { COUNTDOWN_TICKS, LapLoop, crosses } from './lap'
import { FLAT_OVAL } from './tracks'

const gatePoses = () => {
  const p = poses(FLAT_OVAL)
  return FLAT_OVAL.gates.map((g) => ({ kind: g.kind, pose: p[g.segment] }))
}

// Drives the car "through" a gate: one tick 1 m before it, the next 1 m past it.
function passGate(loop: LapLoop, car: CarState, pose: { x: number; z: number; heading: number }): CarState {
  const fx = Math.sin(pose.heading)
  const fz = Math.cos(pose.heading)
  const before = { ...car, tick: car.tick + 1, position: v3(pose.x - fx, 0.7, pose.z - fz) }
  loop.update(before)
  const after = { ...before, tick: before.tick + 1, position: v3(pose.x + fx, 0.7, pose.z + fz) }
  loop.update(after)
  return after
}

function race(isNewBest = () => true) {
  const events: string[] = []
  const finishes: number[] = []
  const loop = new LapLoop(FLAT_OVAL, isNewBest)
  loop.on({
    lapStart: (t) => events.push(`start@${t}`),
    checkpoint: (_t, i) => events.push(`cp${i}`),
    lapFinish: (_t, ms) => {
      events.push('finish')
      finishes.push(ms)
    },
    respawn: () => events.push('respawn'),
  })
  let car = loop.spawn()
  for (let t = 0; t <= COUNTDOWN_TICKS; t++) {
    car = { ...car, tick: t }
    loop.update(car)
  }
  return { loop, car, events, finishes }
}

describe('LapLoop', () => {
  it('holds the car during the countdown and starts racing at its end', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    loop.update({ ...loop.spawn(), tick: COUNTDOWN_TICKS - 1 })
    expect(loop.frozen).toBe(true)
    expect(loop.lapTimeMs(COUNTDOWN_TICKS - 1)).toBe(0)
    loop.update({ ...loop.spawn(), tick: COUNTDOWN_TICKS })
    expect(loop.phase).toBe('racing')
  })

  it('finishes only after every checkpoint in order', () => {
    const { loop, events } = race()
    let { car } = race()
    const gates = gatePoses()
    const cps = gates.filter((g) => g.kind === 'checkpoint')
    const sf = gates.find((g) => g.kind === 'start-finish')!
    expect(cps).toHaveLength(3)
    for (const cp of cps) car = passGate(loop, car, cp.pose)
    car = passGate(loop, car, sf.pose)
    expect(events).toEqual([`start@${COUNTDOWN_TICKS}`, 'cp1', 'cp2', 'cp3', 'finish'])
    expect(loop.phase).toBe('finished')
  })

  it('does not finish when a checkpoint is skipped', () => {
    const { loop, events } = race()
    let { car } = race()
    const gates = gatePoses()
    const cps = gates.filter((g) => g.kind === 'checkpoint')
    const sf = gates.find((g) => g.kind === 'start-finish')!
    car = passGate(loop, car, cps[0].pose)
    car = passGate(loop, car, cps[2].pose) // skips cp2
    car = passGate(loop, car, sf.pose)
    expect(events).toEqual([`start@${COUNTDOWN_TICKS}`, 'cp1'])
    expect(loop.phase).toBe('racing')
  })

  it('times the lap from countdown end to the finish tick', () => {
    const { loop, finishes } = race()
    let { car } = race()
    const gates = gatePoses()
    for (const g of gates.filter((g) => g.kind === 'checkpoint')) car = passGate(loop, car, g.pose)
    car = { ...car, tick: car.tick + 2 * TICK_HZ } // 2 s of driving to the line
    const finishTick = car.tick + 2
    passGate(loop, car, gates.find((g) => g.kind === 'start-finish')!.pose)
    const expected = ((finishTick - COUNTDOWN_TICKS) * 1000) / TICK_HZ
    expect(finishes).toEqual([expected])
    expect(loop.lapTimeMs(finishTick + 500)).toBe(expected) // frozen after finish
  })

  it('respawns at the last checkpoint pose, at rest, on the same tick', () => {
    const { loop, events } = race()
    let { car } = race()
    const cp1 = gatePoses().filter((g) => g.kind === 'checkpoint')[0].pose
    car = passGate(loop, { ...car, velocity: v3(0, 0, 30) }, cp1)
    const respawned = loop.respawn(car.tick)
    expect(respawned.tick).toBe(car.tick) // instant: well under 1 s
    expect(respawned.position.x).toBeCloseTo(cp1.x)
    expect(respawned.position.z).toBeCloseTo(cp1.z)
    expect(respawned.velocity).toEqual(v3())
    expect(respawned.angularVelocity).toEqual(v3())
    const fwd = { x: 2 * respawned.orientation.y * respawned.orientation.w, z: 1 - 2 * respawned.orientation.y ** 2 }
    expect(fwd.x).toBeCloseTo(Math.sin(cp1.heading))
    expect(fwd.z).toBeCloseTo(Math.cos(cp1.heading))
    expect(events.at(-1)).toBe('respawn')
  })

  it('respawns at the start line before the first checkpoint', () => {
    const { loop } = race()
    const r = loop.respawn(400)
    expect(r.position.x).toBeCloseTo(FLAT_OVAL.start.x)
    expect(r.position.z).toBeCloseTo(FLAT_OVAL.start.z)
  })

  it('restart returns to a fresh countdown', () => {
    const { loop } = race()
    const r = loop.restart(1000)
    expect(loop.phase).toBe('countdown')
    expect(loop.passed).toBe(0)
    expect(loop.countdownLeft(1000)).toBe(COUNTDOWN_TICKS)
    expect(r.tick).toBe(1000)
  })
})

describe('crosses', () => {
  const gate = { x: 0, y: 0, z: 10, heading: 0 }
  it('counts a forward crossing within the gate width', () => {
    expect(crosses(gate, v3(0, 0, 9), v3(0, 0, 11))).toBe(true)
  })
  it('ignores backwards crossings and crossings outside the gate', () => {
    expect(crosses(gate, v3(0, 0, 11), v3(0, 0, 9))).toBe(false)
    expect(crosses(gate, v3(20, 0, 9), v3(20, 0, 11))).toBe(false)
  })
})
