// The kit wallride on test-wallride, through the real path (advanceRace, the lap loop, the physics):
// a car placed high on the wall a quarter of the way round the turn, moving along it at `v` at full
// throttle and steered to hold its height (holdLine below, as a driver holds a velodrome line), stays
// on the near-vertical wall when fast enough and slides down off it when too slow. Nothing but v²/r
// against gravity and the tyres' grip decides which (docs/track-kit.md § wallride).
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, quatMul, TICK_HZ, trackSurface, v3, wheelContacts, type CarInput, type CarState } from '../physics'
import { partialPose, poses } from '../track/schema'
import { wallFrame, wallPoint, WALL_RADIUS, type WallrideSegment } from '../track/pose'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { loadTrack } from './autopilot.test-driver'

/** Minimum speed that holds the wall line (pipe angle ≥ ON_WALL on ≥ 3 wheels for HOLD_S), measured by bisection below. */
const V_MIN = 9.3

/** Pipe angle (degrees) the car is placed at and steered to hold: high on the near-vertical wall. */
const LINE = 75
/** On the wall: at or above this pipe angle (degrees). */
const ON_WALL = 65
/** Off the wall: slid down below this pipe angle (degrees), well under the line it is steered to hold. */
const OFF_WALL = 62
/** Seconds the car must hold the line. */
const HOLD_S = 1.5

const track = loadTrack('test-wallride')
const at = track.segments.findIndex((s) => s.type === 'wallride')
const seg = track.segments[at] as WallrideSegment
const entry = poses(track)[at]
const { cx, cz, edge, y: base } = wallFrame(entry, seg)

/** Pipe angle (degrees) of the car: 0 on the road's outer edge, 90 straight up the wall. */
const pipeAngle = (s: CarState): number =>
  (Math.atan2(Math.hypot(s.position.x - cx, s.position.z - cz) - edge, base + WALL_RADIUS - s.position.y) * 180) / Math.PI

/** A driver holding the line: steer down the wall when above it, up when below (PD on the pipe angle). */
function holdLine(): (s: CarState) => CarInput {
  const side = seg.turn === 'left' ? -1 : 1 // + steer (right) climbs a left turn's wall
  let prev: number | null = null
  return (s) => {
    const a = pipeAngle(s)
    const rate = prev === null ? 0 : (a - prev) * TICK_HZ
    prev = a
    const steer = Math.max(-1, Math.min(1, side * (0.15 * (a - LINE) + 0.05 * rate)))
    return { throttle: 1, brake: 0, steer, handbrake: false }
  }
}

type Tick = { angle: number; wheels: number; s: CarState }
type Run = { ticks: Tick[]; respawnTick: number; final: CarState }

function runAt(v: number, seconds = HOLD_S): Run {
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
  // A quarter of the way round, past the wall's ease-in: body up along the wall's normal, nose along the turn.
  const placed = loop.spawn()
  const ride = placed.position.y - track.start.y
  const phi = (LINE * Math.PI) / 180
  const q = wallPoint(entry, seg, 0.25, phi)
  const p = partialPose(entry, seg, 0.25)
  const roll = seg.turn === 'left' ? -phi : phi
  sim.state = {
    ...placed,
    tick: sim.state.tick,
    position: v3(q.x + q.nx * ride, q.y + q.ny * ride, q.z + q.nz * ride),
    orientation: quatMul({ x: 0, y: Math.sin(p.heading / 2), z: 0, w: Math.cos(p.heading / 2) }, { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) }),
    velocity: v3(v * Math.sin(p.heading), 0, v * Math.cos(p.heading)),
  }
  const drive = holdLine()
  let respawnTick = -1
  loop.on({ respawn: (t) => (respawnTick = respawnTick < 0 ? t : respawnTick) })
  const ticks: Tick[] = []
  for (let i = 0; i < seconds * TICK_HZ && respawnTick < 0; i++) {
    advanceRace(loop, sim, 1 / TICK_HZ, drive(sim.state))
    ticks.push({ angle: pipeAngle(sim.state), wheels: wheelContacts(sim.state, sim.surface), s: sim.state })
  }
  return { ticks, respawnTick, final: sim.state }
}

// Holds the line: every tick on the wall (≥ ON_WALL) on ≥ 3 wheels, no respawn.
const holds = (r: Run) => r.respawnTick < 0 && r.ticks.length === HOLD_S * TICK_HZ && r.ticks.every((t) => t.angle >= ON_WALL && t.wheels >= 3)

describe('kit wallride on test-wallride', () => {
  it(`v_min by bisection over 0–40 m/s is ${V_MIN} m/s within 0.5 (docs/track-kit.md § wallride)`, () => {
    let lo = 0
    let hi = 40
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2
      if (holds(runAt(mid))) hi = mid
      else lo = mid
    }
    expect(Math.abs(hi - V_MIN)).toBeLessThan(0.5)
  })

  it.each([1.2, 2, 3])('at %s × v_min the car rides the near-vertical wall on ≥ 3 wheels for 1.5 s', (k) => {
    const r = runAt(k * V_MIN)
    expect(holds(r)).toBe(true)
    // Still riding along the turn, not stalled on the wall: it kept most of its speed.
    const v = r.final.velocity
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(0.8 * k * V_MIN)
  })

  it('at 0.8 × v_min it slides down off the steep wall within 1.5 s', () => {
    const r = runAt(0.8 * V_MIN)
    const off = r.ticks.findIndex((t) => t.angle < OFF_WALL || t.wheels === 0)
    expect(off).toBeGreaterThanOrEqual(0)
    for (const t of r.ticks) expect([t.s.position.x, t.s.position.y, t.s.position.z, t.s.velocity.x, t.s.velocity.y, t.s.velocity.z].every(Number.isFinite)).toBe(true)
  })

  it('a run on the wall replays bit-identically', () => {
    const a = runAt(2 * V_MIN)
    const b = runAt(2 * V_MIN)
    expect(b.final).toEqual(a.final)
  })
})
