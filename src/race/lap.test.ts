import { describe, expect, it } from 'vitest'
import { NO_INPUT, TICK_HZ, v3, type CarState } from '../physics'
import { gateLine } from '../track/schema'
import { COUNTDOWN_TICKS, LapLoop, lapCount, MAX_LAPS, crosses } from './lap'
import { FLAT_OVAL } from './fixture.test-track'

const gatePoses = () => {
  return FLAT_OVAL.gates.map((g) => ({ kind: g.kind, pose: gateLine(FLAT_OVAL, g) }))
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

function race(isNewBest: (totalMs: number) => boolean = () => true, laps = 1) {
  const events: string[] = []
  const finishes: number[] = []
  const loop = new LapLoop(FLAT_OVAL, isNewBest, laps)
  loop.on({
    lapStart: (t, lap) => events.push(lap === 1 ? `start@${t}` : `lap${lap}`),
    raceFinish: (_t, ms, _best, times) => {
      if (laps > 1) events.push(`race ${ms} [${times.join(',')}]`)
    },
    checkpoint: (_t, i) => events.push(`cp${i}`),
    lapFinish: (_t, ms) => {
      events.push('finish')
      finishes.push(ms)
    },
    respawn: () => events.push('respawn'),
    restart: () => events.push('restart'),
  })
  let car = loop.spawn()
  loop.start(0)
  for (let t = 0; t <= COUNTDOWN_TICKS; t++) {
    car = { ...car, tick: t }
    loop.update(car)
  }
  return { loop, car, events, finishes }
}

describe('LapLoop', () => {
  it('waits for Begin, then counts down 3 s and starts racing at its end', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    loop.update({ ...loop.spawn(), tick: 5000 })
    expect(loop.phase).toBe('ready') // no countdown until Begin
    loop.start(5000)
    loop.update({ ...loop.spawn(), tick: 5000 + COUNTDOWN_TICKS - 1 })
    expect(loop.phase).toBe('countdown')
    expect(loop.lapTimeMs(5000 + COUNTDOWN_TICKS - 1)).toBe(0)
    loop.update({ ...loop.spawn(), tick: 5000 + COUNTDOWN_TICKS })
    expect(loop.phase).toBe('racing')
  })

  it('announces the countdown exactly 4 times: 3, 2, 1, then 0 on GO', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    const calls: [number, number][] = []
    loop.on({ countdown: (t, n) => calls.push([n, t]) })
    loop.start(100)
    // Per-tick updates through the countdown and 2 s beyond.
    for (let t = 101; t <= 100 + COUNTDOWN_TICKS + 2 * TICK_HZ; t++) loop.update({ ...loop.spawn(), tick: t })
    expect(calls.map(([n]) => n)).toEqual([3, 2, 1, 0])
    expect(calls.map(([, t]) => t)).toEqual([100, 100 + TICK_HZ, 100 + 2 * TICK_HZ, 100 + COUNTDOWN_TICKS])
  })

  it('announces the countdown the same with coarse per-frame updates, and again on restart', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    const ns: number[] = []
    loop.on({ countdown: (_t, n) => ns.push(n) })
    loop.start(0)
    for (let t = 7; t <= COUNTDOWN_TICKS + 50; t += 7) loop.update({ ...loop.spawn(), tick: t }) // ~14 fps
    loop.restart(COUNTDOWN_TICKS + 60)
    for (let t = COUNTDOWN_TICKS + 61; t <= 2 * COUNTDOWN_TICKS + 100; t++) loop.update({ ...loop.spawn(), tick: t })
    expect(ns).toEqual([3, 2, 1, 0, 3, 2, 1, 0]) // restart: the same 3-2-1-GO
  })

  it('announces 3, 2, 1, GO on restart one second apart, like Begin', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    const calls: [number, number][] = []
    loop.start(0)
    for (let t = 1; t <= COUNTDOWN_TICKS + 10; t++) loop.update({ ...loop.spawn(), tick: t })
    loop.on({ countdown: (t, n) => calls.push([n, t]) })
    const r = COUNTDOWN_TICKS + 20
    loop.restart(r)
    for (let t = r + 1; t <= r + COUNTDOWN_TICKS + 10; t++) loop.update({ ...loop.spawn(), tick: t })
    expect(calls.map(([n]) => n)).toEqual([3, 2, 1, 0])
    expect(calls.map(([, t]) => t - r)).toEqual([0, TICK_HZ, 2 * TICK_HZ, COUNTDOWN_TICKS])
  })

  it('passes input only while racing', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    const throttle = { ...NO_INPUT, throttle: 1 }
    expect(loop.input(throttle)).toEqual(NO_INPUT) // before Begin
    loop.start(0)
    expect(loop.input(throttle)).toEqual(NO_INPUT) // during countdown
    loop.update({ ...loop.spawn(), tick: COUNTDOWN_TICKS })
    expect(loop.input(throttle)).toEqual(throttle) // go
  })

  it('restart before Begin keeps waiting for Begin', () => {
    const loop = new LapLoop(FLAT_OVAL, () => true)
    loop.restart(10)
    expect(loop.phase).toBe('ready')
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
    const { loop, events } = race()
    const r = loop.restart(1000)
    expect(events.at(-1)).toBe('restart')
    expect(loop.phase).toBe('countdown') // Begin already given: straight to the full countdown
    expect(loop.passed).toBe(0)
    expect(loop.countdownLeft(1000)).toBe(COUNTDOWN_TICKS)
    expect(r.tick).toBe(1000)
  })

  it('restart gives control back after the full 3 s countdown, also from the finish panel', () => {
    const { loop, car: start } = race()
    let car = start
    for (const g of gatePoses().filter((g) => g.kind === 'checkpoint')) car = passGate(loop, car, g.pose)
    car = passGate(loop, car, gatePoses().find((g) => g.kind === 'start-finish')!.pose)
    expect(loop.phase).toBe('finished')
    loop.restart(2000)
    let t = 2000
    while (loop.phase !== 'racing' && t < 2000 + 5 * TICK_HZ) loop.update({ ...loop.spawn(), tick: ++t })
    expect(loop.phase).toBe('racing')
    expect(((t - 2000) * 1000) / TICK_HZ).toBe(3000)
    expect(loop.input({ ...NO_INPUT, throttle: 1 }).throttle).toBe(1)
  })
})

describe('LapLoop multi-lap', () => {
  it('changes the lap count only on restart (Settings → Laps), and the next run then needs that many laps', () => {
    const { loop, car: start } = race(() => true, 1)
    expect(loop.laps).toBe(1)
    loop.restart(1000, 2)
    expect(loop.laps).toBe(2)
    let t = 1000
    while (loop.phase !== 'racing') loop.update({ ...loop.spawn(), tick: ++t })
    let car: CarState = { ...start, tick: t }
    const lapOnce = () => {
      for (const g of gatePoses().filter((g) => g.kind === 'checkpoint')) car = passGate(loop, car, g.pose)
      car = passGate(loop, car, gatePoses().find((g) => g.kind === 'start-finish')!.pose)
    }
    lapOnce()
    expect(loop.phase).toBe('racing') // one lap of two
    lapOnce()
    expect(loop.phase).toBe('finished')
    loop.restart(car.tick + 10)
    expect(loop.laps).toBe(2) // a plain restart keeps the count
  })

  const lapOf = (loop: LapLoop, car: CarState, drive = 0): CarState => {
    for (const g of gatePoses().filter((g) => g.kind === 'checkpoint')) car = passGate(loop, car, g.pose)
    car = { ...car, tick: car.tick + drive }
    return passGate(loop, car, gatePoses().find((g) => g.kind === 'start-finish')!.pose)
  }

  it('runs 3 laps: lap events per lap, then one race finish with the total and each lap time', () => {
    const { loop, events } = race(() => true, 3)
    let { car } = race()
    expect(loop.lap).toBe(1)
    car = lapOf(loop, car, 100)
    expect(loop.lap).toBe(2)
    expect(loop.passed).toBe(0)
    expect(loop.phase).toBe('racing')
    car = lapOf(loop, car, 300)
    car = lapOf(loop, car, 200)
    expect(loop.phase).toBe('finished')
    const [a, b, c] = loop.lapTimes
    expect(b - a).toBe(2000) // 200 extra ticks
    expect(c - a).toBe(1000)
    const total = a + b + c
    expect(loop.lapTimeMs(car.tick)).toBe(total)
    const lapEvents = (n: number) => ['cp1', 'cp2', 'cp3', 'finish', ...(n < 3 ? [`lap${n + 1}`] : [])]
    expect(events).toEqual([`start@${COUNTDOWN_TICKS}`, ...lapEvents(1), ...lapEvents(2), ...lapEvents(3), `race ${total} [${a},${b},${c}]`])
  })

  it('judges the best on the run total, once', () => {
    const judged: number[] = []
    const { loop } = race((ms) => judged.push(ms) > 0, 2)
    let { car } = race()
    car = lapOf(loop, car)
    expect(judged).toEqual([])
    lapOf(loop, car)
    expect(judged).toEqual([loop.lapTimes[0] + loop.lapTimes[1]])
  })

  it('respawns at the start line in a later lap before its first checkpoint, and at that lap\'s checkpoint after', () => {
    const { loop } = race(() => true, 3)
    let { car } = race()
    car = lapOf(loop, car)
    expect(loop.respawn(car.tick).position.z).toBeCloseTo(FLAT_OVAL.start.z)
    const cp1 = gatePoses().filter((g) => g.kind === 'checkpoint')[0].pose
    car = passGate(loop, car, cp1)
    expect(loop.respawn(car.tick).position.x).toBeCloseTo(cp1.x)
    expect(loop.lap).toBe(2)
  })

  it('restart goes back to lap 1 with no lap times', () => {
    const { loop } = race(() => true, 3)
    let { car } = race()
    car = lapOf(loop, car)
    loop.restart(car.tick + 1)
    expect(loop.lap).toBe(1)
    expect(loop.lapTimes).toEqual([])
  })

  it('tracks the run best lap: null before the first lap, the fastest after, null again after restart', () => {
    const { loop } = race(() => true, 3)
    let { car } = race()
    expect(loop.runBestMs).toBeNull()
    car = lapOf(loop, car, 300)
    const first = loop.lapTimes[0]
    expect(loop.runBestMs).toBe(first)
    car = lapOf(loop, car)
    expect(loop.runBestMs).toBe(loop.lapTimes[1])
    expect(loop.runBestMs).toBe(first - 3000)
    loop.restart(car.tick + 1)
    expect(loop.runBestMs).toBeNull()
  })
})

describe('lapCount', () => {
  it('reads ?laps=N, defaulting to 1 and capping at MAX_LAPS', () => {
    expect(lapCount('')).toBe(1)
    expect(lapCount('?track=lap2&laps=3')).toBe(3)
    expect(lapCount('?laps=0')).toBe(1)
    expect(lapCount('?laps=2.5')).toBe(1)
    expect(lapCount('?laps=abc')).toBe(1)
    expect(lapCount('?laps=99')).toBe(MAX_LAPS)
  })
  it('falls back to the saved setting; a valid ?laps= overrides it', () => {
    expect(lapCount('', 3)).toBe(3)
    expect(lapCount('?laps=', 3)).toBe(3)
    expect(lapCount('?laps=x', 3)).toBe(3)
    expect(lapCount('?laps=2', 3)).toBe(2)
    expect(lapCount('?laps=1', 3)).toBe(1)
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
  it('ignores a road passing under the gate (multi-level tracks); a jump over it still counts', () => {
    expect(crosses(gate, v3(0, -8, 9), v3(0, -8, 11))).toBe(false) // an underpass below a deck gate
    expect(crosses(gate, v3(0, 9, 9), v3(0, 9, 11))).toBe(true) // airborne over the arch after a gap jump
    expect(crosses(gate, v3(0, 25, 9), v3(0, 25, 11))).toBe(false) // far above: a different level
  })
  it('flips the height window for a gate hanging at a loop\'s top: counts the car upside down under the road, not the ground below', () => {
    const top = { x: 0, y: 30, z: 10, heading: 0 }
    expect(crosses(top, v3(0, 27, 9), v3(0, 27, 11), -1)).toBe(true) // inside the loop, 3 m under the road
    expect(crosses(top, v3(0, 0.5, 9), v3(0, 0.5, 11), -1)).toBe(false) // on the run-in, 30 m below
    expect(crosses(top, v3(0, 31, 9), v3(0, 31, 11), -1)).toBe(true) // within GATE_BELOW over the road's back
    expect(crosses(top, v3(0, 27, 9), v3(0, 27, 11))).toBe(false) // upright, the same crossing is an underpass
  })
})
