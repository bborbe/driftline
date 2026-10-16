// Off-track ground must never pay: for every checkpoint-to-checkpoint leg and every corner on the
// shipped laps, a full-throttle driver cutting straight across the grass is slower than the
// autopilot's fast road line (racingLine) through the same two lines. Runs that never reach the
// line within twice the road time count as slower.
import { describe, expect, it } from 'vitest'
import { FixedStepper, forwardOf, materialUnder, NO_INPUT, step, TICK_HZ, trackSurface, type CarInput, type CarState, type Surface } from '../physics'
import { exitPose, gateLine, poses, type Pose, type Track } from '../track/schema'
import { advanceRace, COUNTDOWN_TICKS, crosses, LapLoop } from './lap'
import { autopilot, loadTrack, racingLine } from './autopilot.test-driver'

const CORNER = new Set(['curve', 'hairpin', 'banked'])
const LOOKAHEAD = 0.5 // s
// A run counts as a grass cut once this share of its ticks is off the road.
const GRASS_SHARE = 0.1
// Aim points across the target line: the cutter may cross it anywhere a gate would count.
const AIM_OFFSETS = [-5, -2.5, 0, 2.5, 5]
// How far before the line the cutter lines up (m): 0 = straight at it.
const APPROACH = [0, 10, 20]

// The autopilot's lap on the fast road line, one state per tick from GO to the finish, no respawn.
function roadRun(track: Track): CarState[] {
  const loop = new LapLoop(track, () => true)
  const surface = trackSurface(track)
  const sim = new FixedStepper(loop.spawn(), surface)
  const drive = autopilot(racingLine(track), LOOKAHEAD)
  let respawns = 0
  loop.on({ respawn: () => respawns++ })
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
  const states = [sim.state]
  while (loop.phase !== 'finished' && states.length < 120 * TICK_HZ) {
    advanceRace(loop, sim, 1 / TICK_HZ, drive(sim.state))
    states.push(sim.state)
  }
  expect(loop.phase).toBe('finished')
  expect(respawns).toBe(0)
  const offroad = states.filter((st) => materialUnder(st, surface) === 'offroad').length
  expect(offroad, 'the road line stays on the asphalt').toBeLessThan(0.02 * states.length)
  return states
}

// First tick at or after `from` whose step crosses `pose`'s line.
const crossingTick = (states: CarState[], pose: Pose, from: number): number => {
  for (let i = Math.max(from, 1); i < states.length; i++) if (crosses(pose, states[i - 1].position, states[i].position)) return i
  return -1
}

type Run = { ticks: number; grass: number } // ticks to the target line (Infinity = never), ticks on grass
type Point = { x: number; z: number }

// Full throttle from `start` straight at `approach`, then on through `target` (gates only count
// forwards); stops when the car crosses `target`'s line.
function cut(start: CarState, approach: Point, target: Pose, surface: Surface, limit: number): Run {
  const beyond = { x: target.x + 10 * Math.sin(target.heading), z: target.z + 10 * Math.cos(target.heading) }
  let aim = approach
  let s = start
  let grass = 0
  for (let t = 1; t <= limit; t++) {
    if (Math.hypot(aim.x - s.position.x, aim.z - s.position.z) < 4) aim = beyond
    const f = forwardOf(s)
    const dx = aim.x - s.position.x
    const dz = aim.z - s.position.z
    const angle = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz)
    const input: CarInput = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, 2.5 * angle)), handbrake: false }
    const next = step(s, input, surface)
    if (materialUnder(next, surface) === 'offroad') grass++
    if (crosses(target, s.position, next.position)) return { ticks: t, grass }
    s = next
  }
  return { ticks: Infinity, grass }
}

// The lines to compare between: consecutive gates (start → checkpoints → finish), then each run of
// consecutive corner pieces (split at gates) from its entry to its exit.
function legs(track: Track): { name: string; from: Pose; to: Pose }[] {
  const entries = poses(track)
  const sf = track.gates.find((g) => g.kind === 'start-finish')!
  const gates = [track.start, ...track.gates.filter((g) => g.kind === 'checkpoint').map((g) => gateLine(track, g)), gateLine(track, sf)]
  const out = gates.slice(1).map((to, i) => ({ name: `gate ${i} → ${i + 1}`, from: gates[i], to }))
  // A run stops at a checkpoint: a cut that skips a gate is not a lap at all.
  const gated = (k: number) => track.gates.some((g) => g.segment === k)
  let i = 0
  while (i < track.segments.length) {
    if (!CORNER.has(track.segments[i].type)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < track.segments.length && CORNER.has(track.segments[j + 1].type) && !gated(j + 1)) j++
    out.push({ name: `corner ${i}-${j}`, from: entries[i], to: exitPose(entries[j], track.segments[j]) })
    i = j + 1
  }
  return out
}

describe.each(['lap1', 'lap2'])('%s grass cuts', (name) => {
  const track = loadTrack(name)
  const surface = trackSurface(track)
  const road = roadRun(track)

  it.each(legs(track))('$name: no straight cut across the grass beats the road line', ({ from, to }) => {
    const a = from === track.start ? 0 : crossingTick(road, from, 0)
    expect(a).toBeGreaterThanOrEqual(0)
    const b = crossingTick(road, to, a + 1)
    expect(b).toBeGreaterThan(a)
    const fwd = { x: Math.sin(to.heading), z: Math.cos(to.heading) }
    const across = { x: fwd.z, z: -fwd.x }
    const runs = AIM_OFFSETS.flatMap((o) =>
      APPROACH.map((d) => cut(road[a], { x: to.x + across.x * o - fwd.x * d, z: to.z + across.z * o - fwd.z * d }, to, surface, 2 * (b - a))),
    )
    // A run that stays on the asphalt is a faster road line, not a cut: it raises the bar.
    const onGrass = (r: Run) => r.grass >= GRASS_SHARE * r.ticks
    const roadBest = Math.min(b - a, ...runs.filter((r) => !onGrass(r)).map((r) => r.ticks))
    const cutBest = Math.min(...runs.filter(onGrass).map((r) => r.ticks))
    expect(cutBest, `best grass cut ${cutBest} ticks vs road ${roadBest}`).toBeGreaterThan(roadBest)
  })
})
