// A loop cannot be shortcut (operator, 2026-10-17, test-loop): its exit runs one road width beside
// its entry (LOOP_SHIFT), so a car can change lanes at the foot and drive on without going round.
// Every loop carries a checkpoint at its top, so that lane change no longer completes a lap, while
// the autopilot's lap round the loop still does — on every catalogue track with a loop.
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, TICK_HZ, trackSurface, wheelContacts } from '../physics'
import { gateLine, poses, type Track } from '../track/schema'
import { LOOP_SHIFT, partialPose, turnSign } from '../track/pose'
import { CAMPAIGN, STYLES, TEST_TRACKS } from '../track/catalogue'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, hasLoop, loadTrack, type Sample } from './autopilot.test-driver'

const LAP_TIMEOUT = 30_000
const LOOP_TRACKS = [...new Set([...TEST_TRACKS, ...CAMPAIGN.map((l) => l.track), ...STYLES.map((l) => l.track)])]
  .map((n) => loadTrack(n))
  .filter(hasLoop)

type Lap = { finished: boolean; checkpoints: number }

function drive(track: Track, line: Sample[], loops: boolean): Lap {
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const pilot = autopilot(line, 0, loops)
  let checkpoints = 0
  loop.on({ checkpoint: () => checkpoints++ })
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
  for (let i = 0; i < 40 * TICK_HZ && loop.phase !== 'finished'; i++) advanceRace(loop, sim, 1 / TICK_HZ, pilot(sim.state))
  return { finished: loop.phase === 'finished', checkpoints }
}

// The centreline (20 samples a segment) with every loop cut out: the line drives the run-in to the
// foot of the climb, then hops one road width sideways into the exit lane, which starts right
// beside the foot (LOOP_SHIFT), while the climb is still low. The loop itself is never driven.
const BYPASS_SPEED = 10
// Share of the run-out over which the line is back in the exit lane.
const BYPASS_HOP = 0.4
const bypassLine = (track: Track): Sample[] => {
  const n = track.segments.length
  return centreline(track).flatMap((s, k) => {
    const i = Math.floor(k / 20)
    const f = (k % 20) / 20
    const seg = track.segments[i]
    const prev = track.segments[(i + n - 1) % n]
    const next = track.segments[(i + 1) % n]
    if (seg.type === 'loop') return []
    // Slow over the run-in and the piece before it (looping's turbo), so the hop holds the lane.
    if (next.type === 'loop' || track.segments[(i + 2) % n].type === 'loop') return [{ ...s, speed: Math.min(s.speed, BYPASS_SPEED) }]
    if (prev.type !== 'loop') return [s]
    // Left of travel (m), from the climb's line at the foot back to the exit lane.
    const lateral = -turnSign(prev) * LOOP_SHIFT * Math.max(0, 1 - f / BYPASS_HOP)
    const { x, y, z, heading } = s.pose
    return [{ pose: { x: x + Math.cos(heading) * lateral, y, z: z - Math.sin(heading) * lateral, heading }, speed: BYPASS_SPEED }]
  })
}

describe('loop apex checkpoint', () => {
  it('finds the catalogue loop tracks (test-loop, looping)', () => {
    expect(LOOP_TRACKS.map((t) => t.name)).toEqual(expect.arrayContaining(['test-loop', 'looping']))
  })

  for (const track of LOOP_TRACKS) {
    describe(track.name, () => {
      it('has a checkpoint at the top of every loop', () => {
        const entries = poses(track)
        track.segments.forEach((seg, i) => {
          if (seg.type !== 'loop') return
          const top = partialPose(entries[i], seg, 0.5)
          const gate = track.gates.find((g) => g.kind === 'checkpoint' && g.segment === i)
          expect(gate, `${track.name}: loop segment ${i} has a checkpoint`).toBeDefined()
          const line = gateLine(track, gate!)
          expect(Math.hypot(line.x - top.x, line.y - top.y, line.z - top.z)).toBeLessThan(1e-6)
          expect(line.y - entries[i].y).toBeCloseTo(2 * seg.radius, 6)
        })
      })

      it('a lap that changes lanes at the foot of the loop instead of going round does not complete', { timeout: LAP_TIMEOUT }, () => {
        expect(drive(track, bypassLine(track), false).finished).toBe(false)
      })

      it('a respawn after the top puts the car upright at rest at the loop\'s exit, where it stays on the road', () => {
        const loop = new LapLoop(track, () => true)
        const sim = new FixedStepper(loop.spawn(), trackSurface(track))
        const pilot = autopilot(centreline(track), 0, true)
        const at = track.segments.findIndex((s) => s.type === 'loop')
        const top = gateLine(track, track.gates.find((g) => g.segment === at)!)
        let passedTop = false
        loop.on({ checkpoint: () => (passedTop ||= Math.abs(sim.state.position.y - top.y) < 5) })
        loop.start(sim.state.tick)
        for (let i = 0; i < COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
        for (let i = 0; i < 40 * TICK_HZ && !passedTop; i++) advanceRace(loop, sim, 1 / TICK_HZ, pilot(sim.state))
        expect(passedTop, 'the lap scores the top').toBe(true)
        sim.state = loop.respawn(sim.state.tick) // R, as the player respawns
        const exit = partialPose(poses(track)[at], track.segments[at], 1)
        expect(Math.hypot(sim.state.position.x - exit.x, sim.state.position.z - exit.z)).toBeLessThan(1e-6)
        let respawns = 0
        loop.on({ respawn: () => respawns++ })
        for (let i = 0; i < 2 * TICK_HZ; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
        expect(respawns).toBe(0)
        expect(Math.abs(sim.state.position.y - exit.y)).toBeLessThan(1.5)
        expect(wheelContacts(sim.state, sim.surface)).toBe(4)
      })

      it('the autopilot lap round the loop passes every checkpoint, the top included, and finishes', { timeout: LAP_TIMEOUT }, () => {
        const lap = drive(track, centreline(track), true)
        expect(lap.finished).toBe(true)
        expect(lap.checkpoints).toBe(new LapLoop(track, () => true).checkpointCount)
      })
    })
  }
})
