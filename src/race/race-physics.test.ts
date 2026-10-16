// The lap loop driving the real car physics on lap1: input gating and the fall safety net.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCarAt, FixedStepper, NO_INPUT, TICK_HZ, trackSurface, type CarInput, type Surface } from '../physics'
import type { Track } from '../track/schema'
import { advanceRace, COUNTDOWN_TICKS, FALL_DEPTH, GROUND_Y, LapLoop } from './lap'

const lap1 = JSON.parse(readFileSync(new URL('../../assets/track/lap1.json', import.meta.url), 'utf8')) as Track
const THROTTLE: CarInput = { ...NO_INPUT, throttle: 1 }

// One physics tick through the loop, exactly as race.frame() does it.
function tick(loop: LapLoop, sim: FixedStepper, raw: CarInput): CarState | null {
  return advanceRace(loop, sim, 1 / TICK_HZ, raw)
}
type CarState = FixedStepper['state']

function setup(surface: Surface = trackSurface(lap1)) {
  const loop = new LapLoop(lap1, () => true)
  const sim = new FixedStepper(loop.spawn(), surface)
  return { loop, sim }
}

describe('race input gate', () => {
  it('holding throttle before Begin leaves the car at rest at the start', () => {
    const { loop, sim } = setup()
    const start = sim.state.position
    for (let i = 0; i < 5 * TICK_HZ; i++) tick(loop, sim, THROTTLE)
    expect(Math.abs(sim.state.position.x - start.x)).toBeLessThan(1e-3)
    expect(Math.abs(sim.state.position.z - start.z)).toBeLessThan(1e-3)
    expect(Math.hypot(sim.state.velocity.x, sim.state.velocity.z)).toBeLessThan(1e-3)
  })

  it('after Begin the car stays put through the countdown and drives on go', () => {
    const { loop, sim } = setup()
    loop.start(sim.state.tick)
    const start = sim.state.position
    for (let i = 0; i < COUNTDOWN_TICKS - 1; i++) tick(loop, sim, THROTTLE)
    expect(loop.phase).toBe('countdown')
    expect(Math.abs(sim.state.position.z - start.z)).toBeLessThan(1e-3)
    for (let i = 0; i < 2 * TICK_HZ; i++) tick(loop, sim, THROTTLE)
    expect(loop.phase).toBe('racing')
    expect(sim.state.position.z - start.z).toBeGreaterThan(5)
  })
})

describe('fall safety net', () => {
  it('driving off the world edge respawns at the start line as soon as the car is 5 m down', () => {
    // No ground plane: leaving the track means falling forever.
    const { loop, sim } = setup(trackSurface(lap1, { groundY: null }))
    loop.start(sim.state.tick)
    for (let i = 0; i <= COUNTDOWN_TICKS; i++) tick(loop, sim, NO_INPUT)
    const respawns: number[] = []
    loop.on({ respawn: (t) => respawns.push(t) })
    // Steer hard left right away: off the 10 m wide straight long before the first checkpoint.
    let belowAt = -1
    let respawnedAt = -1
    let car: CarState | null = null
    for (let i = 0; i < 10 * TICK_HZ && respawnedAt < 0; i++) {
      const before = sim.state
      car = tick(loop, sim, { ...THROTTLE, steer: -1 })
      if (belowAt < 0 && before.position.y < GROUND_Y - FALL_DEPTH + 0.2) belowAt = before.tick
      if (car) respawnedAt = car.tick
    }
    expect(respawnedAt).toBeGreaterThan(0)
    expect(respawns).toEqual([respawnedAt])
    expect((respawnedAt - belowAt) / TICK_HZ).toBeLessThan(1) // fires within 1 s of falling past the threshold
    expect(sim.state.position.x).toBeCloseTo(lap1.start.x)
    expect(sim.state.position.z).toBeCloseTo(lap1.start.z)
    expect(sim.state.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(loop.phase).toBe('racing') // timer keeps running
    expect(loop.lapTimeMs(sim.state.tick)).toBeGreaterThan(0)
  })

  it('respawns after more than 3 s with no wheel on any surface', () => {
    const loop = new LapLoop(lap1, () => true)
    loop.start(0)
    let car = { ...createCarAt(lap1.start), tick: COUNTDOWN_TICKS }
    loop.update(car, 4)
    let respawned: CarState | null = null
    let t = COUNTDOWN_TICKS
    // Hovering 2 m up (above the fall line), airborne: only the 3 s rule can fire.
    while (!respawned && t < COUNTDOWN_TICKS + 5 * TICK_HZ) {
      t++
      car = { ...car, tick: t, position: { ...car.position, y: 2 } }
      respawned = loop.update(car, 0)
    }
    expect(respawned).not.toBeNull()
    expect((t - COUNTDOWN_TICKS) / TICK_HZ).toBeCloseTo(3, 1)
  })

  it('a normal ramp jump on lap1 does not trigger a respawn', () => {
    const { loop, sim } = setup()
    loop.start(sim.state.tick)
    let respawns = 0
    for (let i = 0; i < COUNTDOWN_TICKS + 12 * TICK_HZ; i++) if (tick(loop, sim, THROTTLE)) respawns++
    expect(respawns).toBe(0)
  })
})

describe('pause', () => {
  it('paused frames freeze tick, countdown, lap timer and car; resume continues exactly', () => {
    const run = (pauseAt: number | null) => {
      const { loop, sim } = setup()
      loop.start(sim.state.tick)
      const frozen: { tick: number; left: number; ms: number }[] = []
      for (let i = 0; i < COUNTDOWN_TICKS + 3 * TICK_HZ; i++) {
        if (i === pauseAt) {
          const before = { tick: sim.state.tick, left: loop.countdownLeft(sim.state.tick), ms: loop.lapTimeMs(sim.state.tick), pos: sim.state.position }
          // 5 s of wall time in odd-sized frames while paused.
          for (let f = 0; f < 300; f++) advanceRace(loop, sim, 0.0167, THROTTLE, true)
          expect(sim.state.tick).toBe(before.tick)
          expect(loop.countdownLeft(sim.state.tick)).toBe(before.left)
          expect(loop.lapTimeMs(sim.state.tick)).toBe(before.ms)
          expect(sim.state.position).toEqual(before.pos)
          frozen.push(before)
        }
        tick(loop, sim, THROTTLE)
      }
      return { state: sim.state, frozen }
    }
    const plain = run(null)
    const inCountdown = run(COUNTDOWN_TICKS / 2)
    const midLap = run(COUNTDOWN_TICKS + TICK_HZ)
    expect(inCountdown.frozen[0].left).toBeGreaterThan(0)
    expect(midLap.frozen[0].ms).toBeGreaterThan(0)
    expect(inCountdown.state).toEqual(plain.state)
    expect(midLap.state).toEqual(plain.state)
  })
})
