// The kit loop on test-loop, through the real path (advanceRace, the lap loop, the physics): a car
// fast enough stays on through the top upside down and drives out; one too slow falls off and is
// respawned; a run replays bit-identically. Entry speed is set one way everywhere here: the car is
// placed 2 m before the loop on its run-in, moving at `v` along the heading, at full throttle, and
// steered round by the loop-aware autopilot (docs/track-kit.md § loop).
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, rotate, TICK_HZ, trackSurface, v3, wheelContacts, type CarState } from '../physics'
import { KIT_LOOP_RADIUS } from '../track/kit'
import { poses, type Pose } from '../track/schema'
import { LOOP_SHIFT, loopTubes } from '../track/pose'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack } from './autopilot.test-driver'

/** Minimum entry speed that stays on the road through the top, measured by bisection below. */
const V_MIN = 12.1

const track = loadTrack('test-loop')
const at = track.segments.findIndex((s) => s.type === 'loop')
const entry: Pose = poses(track)[at]

type Tick = { s: CarState; wheels: number; upY: number; theta: number }
type Run = { ticks: Tick[]; respawnTick: number; final: CarState }

// Sweep of the car round the loop (0 = entry, π = top), from its position about the loop's axis.
const sweep = (s: CarState): number => {
  const fx = Math.sin(entry.heading)
  const fz = Math.cos(entry.heading)
  const along = (s.position.x - entry.x) * fx + (s.position.z - entry.z) * fz
  const th = Math.atan2(along, -(s.position.y - entry.y - KIT_LOOP_RADIUS))
  return th < 0 ? th + 2 * Math.PI : th
}

function runAt(v: number, ticks = 6 * TICK_HZ): Run {
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
  const fx = Math.sin(entry.heading)
  const fz = Math.cos(entry.heading)
  const placed = loop.spawn()
  sim.state = {
    ...placed,
    tick: sim.state.tick,
    position: v3(entry.x - 2 * fx, placed.position.y - track.start.y + entry.y, entry.z - 2 * fz),
    orientation: { x: 0, y: Math.sin(entry.heading / 2), z: 0, w: Math.cos(entry.heading / 2) },
    velocity: v3(v * fx, 0, v * fz),
  }
  const drive = autopilot(centreline(track), 0, true)
  let respawnTick = -1
  loop.on({ respawn: (t) => (respawnTick = respawnTick < 0 ? t : respawnTick) })
  const out: Tick[] = []
  for (let i = 0; i < ticks && respawnTick < 0; i++) {
    advanceRace(loop, sim, 1 / TICK_HZ, { ...drive(sim.state), throttle: 1, brake: 0 })
    const s = sim.state
    out.push({ s, wheels: wheelContacts(s, sim.surface), upY: rotate(s.orientation, v3(0, 1, 0)).y, theta: sweep(s) })
  }
  return { ticks: out, respawnTick, final: sim.state }
}

// Inside the loop proper (the tube above its foot), as the lap loop and the camera see it.
const inTube = loopTubes(track)
const inLoop = (t: Tick) => inTube(t.s.position)
// Stays on: every tick inside the loop has ≥ 3 wheels down, it is upside down at the top, no respawn.
const stays = (r: Run) => r.respawnTick < 0 && r.ticks.some((t) => t.upY < -0.9) && r.ticks.filter(inLoop).every((t) => t.wheels >= 3)

describe('kit loop on test-loop', () => {
  it(`v_min by bisection is ${V_MIN} m/s within 0.3 (docs/track-kit.md § loop)`, () => {
    let lo = 0
    let hi = 30
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2
      if (stays(runAt(mid))) hi = mid
      else lo = mid
    }
    expect(Math.abs(hi - V_MIN)).toBeLessThan(0.3)
  })

  it('at 1.1 × v_min the car crosses the top upside down on ≥ 3 wheels and drives out on the road', () => {
    const r = runAt(1.1 * V_MIN)
    const top = r.ticks.filter((t) => t.upY < -0.9)
    expect(top.length).toBeGreaterThan(0)
    expect(Math.min(...top.map((t) => t.wheels))).toBeGreaterThanOrEqual(3)
    expect(r.ticks.filter(inLoop).every((t) => t.wheels >= 3)).toBe(true)
    expect(r.respawnTick).toBe(-1)
    // Out of the loop after the top: upright on four wheels at the entry's height, in the exit lane
    // one road width to the right (LOOP_SHIFT), heading on the way it came in.
    const after = r.ticks.slice(r.ticks.lastIndexOf(top[top.length - 1]) + 1)
    const out = after.find((t) => !inLoop(t) && Math.abs(t.s.position.y - entry.y) < 1)
    expect(out, 'leaves the loop on the road').toBeDefined()
    const lateral = (out!.s.position.x - entry.x) * Math.cos(entry.heading) - (out!.s.position.z - entry.z) * Math.sin(entry.heading)
    expect(Math.abs(lateral - -LOOP_SHIFT)).toBeLessThan(3)
    expect(out!.upY).toBeGreaterThan(0.95)
    expect(out!.wheels).toBe(4)
  })

  it('at 0.9 × v_min it loses every wheel before the top and the lap loop respawns it within 3.5 s', () => {
    const r = runAt(0.9 * V_MIN)
    const detach = r.ticks.findIndex((t) => inLoop(t) && t.wheels === 0)
    expect(detach).toBeGreaterThanOrEqual(0)
    expect(r.ticks[detach].theta).toBeLessThan(Math.PI)
    expect(r.respawnTick).toBeGreaterThan(0)
    expect(r.respawnTick - r.ticks[detach].s.tick).toBeLessThanOrEqual(3.5 * TICK_HZ)
    for (const t of r.ticks) expect([t.s.position.x, t.s.position.y, t.s.position.z, t.s.velocity.x, t.s.velocity.y, t.s.velocity.z].every(Number.isFinite)).toBe(true)
  })

  it('a run through the loop replays bit-identically', () => {
    const a = runAt(1.1 * V_MIN)
    const b = runAt(1.1 * V_MIN)
    expect(b.ticks.length).toBe(a.ticks.length)
    expect(b.final).toEqual(a.final)
  })
})
