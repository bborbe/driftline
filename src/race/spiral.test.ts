// The kit spiral on test-spiral, through the real path (advanceRace, the lap loop, the physics): the
// loop whose road drifts KIT_SPIRAL_SHIFT cells sideways on the way round. A car driven in at the
// kit loop's pace by the loop-aware autopilot crosses the top upside down and comes out on the
// parallel exit line, upright on four wheels; the run replays bit-identically (docs/track-kit.md § spiral).
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, rotate, TICK_HZ, trackSurface, v3, wheelContacts, type CarState } from '../physics'
import { CELL, poses, type Pose } from '../track/schema'
import { KIT_SPIRAL_SHIFT } from '../track/kit'
import { loopShiftOf, loopTubes, turnSign, type LoopSegment } from '../track/pose'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack } from './autopilot.test-driver'

const track = loadTrack('test-spiral')
const at = track.segments.findIndex((s) => s.type === 'loop')
const seg = track.segments[at] as LoopSegment
const entry: Pose = poses(track)[at]

type Tick = { s: CarState; wheels: number; upY: number }

function runAt(v: number, ticks = 6 * TICK_HZ): { ticks: Tick[]; respawnTick: number; final: CarState } {
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
    out.push({ s, wheels: wheelContacts(s, sim.surface), upY: rotate(s.orientation, v3(0, 1, 0)).y })
  }
  return { ticks: out, respawnTick, final: sim.state }
}

const inTube = loopTubes(track)

describe('kit spiral on test-spiral', () => {
  it('drifts its road KIT_SPIRAL_SHIFT cells (20 m) to the turn side: twice the kit loop', () => {
    expect(loopShiftOf(seg)).toBe(KIT_SPIRAL_SHIFT * CELL)
    expect(KIT_SPIRAL_SHIFT * CELL).toBe(20)
  })

  it.each([16, 22])('at %s m/s it crosses the top upside down and leaves on the exit line 20 m over, upright on 4 wheels', (v) => {
    const r = runAt(v)
    expect(r.respawnTick).toBe(-1)
    const top = r.ticks.filter((t) => t.upY < -0.9)
    expect(top.length).toBeGreaterThan(0)
    expect(r.ticks.filter((t) => inTube(t.s.position)).every((t) => t.wheels >= 3)).toBe(true)
    const after = r.ticks.slice(r.ticks.lastIndexOf(top[top.length - 1]) + 1)
    const out = after.find((t) => !inTube(t.s.position) && Math.abs(t.s.position.y - entry.y) < 1)
    expect(out, 'leaves the spiral on the road').toBeDefined()
    // Left of the entry heading is (+cos h, −sin h); a right spiral exits on the negative side.
    const lateral = (out!.s.position.x - entry.x) * Math.cos(entry.heading) - (out!.s.position.z - entry.z) * Math.sin(entry.heading)
    expect(Math.abs(lateral - turnSign(seg) * loopShiftOf(seg))).toBeLessThan(3)
    expect(out!.upY).toBeGreaterThan(0.95)
    expect(out!.wheels).toBe(4)
  })

  it('a run through the spiral replays bit-identically', () => {
    expect(runAt(18).final).toEqual(runAt(18).final)
  })
})
