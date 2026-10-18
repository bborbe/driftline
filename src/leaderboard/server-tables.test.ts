// The leaderboard server's track table and golden run, generated from the game so the server never holds a
// hand-copied number. The table (server/pkg/track/tracks.json) lists every shipped track with a finish and
// an author medal: its checkpoint count from the loaded track (kit tracks compute their gates in code) and
// its tick floor, half the author medal — a lap twice as fast as the author's is not a lap. The golden run
// (server/pkg/run/testdata/golden-run.json) is one autopilot lap on test1, recorded by GhostRecorder and
// encoded by ghostPayload exactly as the game submits it; the server's Go tests must accept it.
// Re-generate after a track, medal or encoder change, then commit both files:
//   UPDATE_SERVER_TRACKS=1 npx vitest run src/leaderboard/server-tables.test.ts
// The table is drift-guarded below (no physics, so stable on every platform); the golden run is not
// compared byte for byte, because the physics rounds differently across platforms (golden-replay.test.ts).
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ghostPayload } from '../challenge/link'
import { GhostRecorder } from '../ghost/ghost'
import { FixedStepper, NO_INPUT, TICK_HZ, trackSurface } from '../physics'
import { autopilot, centreline } from '../race/autopilot.test-driver'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from '../race/lap'
import { LAP_NAMES, loadLap } from '../track/registry'

type TrackRow = { name: string; checkpoints: number; floorTicks: number }

const TRACKS_FILE = new URL('../../server/pkg/track/tracks.json', import.meta.url)
const GOLDEN_FILE = new URL('../../server/pkg/run/testdata/golden-run.json', import.meta.url)
const GOLDEN_TRACK = 'test1'

const trackTable = (): TrackRow[] =>
  LAP_NAMES.map((name) => ({ name, track: loadLap(name) }))
    .filter(({ track }) => !track.pad && track.medals?.author && track.gates.some((g) => g.kind === 'start-finish'))
    .map(({ name, track }) => ({
      name,
      checkpoints: track.gates.filter((g) => g.kind === 'checkpoint').length,
      floorTicks: Math.ceil((track.medals!.author * TICK_HZ) / 1000 / 2),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

// One track per line, so the file diffs per track.
const tableJson = (): string => `[\n${trackTable().map((t) => `  ${JSON.stringify(t)}`).join(',\n')}\n]\n`

// One autopilot lap, recorded the way the race records the player's: ghost from sim.fed, splits from the
// checkpoint events, both relative to the lap's first tick.
const goldenRun = () => {
  const track = loadLap(GOLDEN_TRACK)
  const loop = new LapLoop(track, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const recorder = new GhostRecorder()
  loop.on(recorder.listener(() => sim.state))
  let lapStart = 0
  const checkpointTicks: number[] = []
  loop.on({ lapStart: (tick) => (lapStart = tick), checkpoint: (tick) => checkpointTicks.push(tick - lapStart) })
  const drive = autopilot(centreline(track))
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; i++) {
    advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
    recorder.consume(sim.fed)
  }
  const ghost = recorder.best
  if (!ghost) throw new Error(`no autopilot lap on ${GOLDEN_TRACK}`)
  return { name: 'GOLDEN', track: GOLDEN_TRACK, totalTicks: ghost.inputs.length, checkpointTicks, ghost: ghostPayload(ghost) }
}

describe('leaderboard server tables', () => {
  if (process.env.UPDATE_SERVER_TRACKS === '1') {
    it('re-generates tracks.json and golden-run.json', () => {
      writeFileSync(TRACKS_FILE, tableJson())
      writeFileSync(GOLDEN_FILE, JSON.stringify(goldenRun()) + '\n')
    }, 60_000)
    return
  }
  const table: TrackRow[] = JSON.parse(readFileSync(TRACKS_FILE, 'utf8'))
  it('tracks.json equals a fresh generation (re-generate: UPDATE_SERVER_TRACKS=1)', () => {
    expect(readFileSync(TRACKS_FILE, 'utf8')).toBe(tableJson())
  })
  it('lists the medal tracks with a checkpoint and a floor each', () => {
    expect(table.map((t) => t.name)).toEqual(expect.arrayContaining(['crossover', 'test1', 'test2']))
    for (const t of table) {
      expect(t.checkpoints, t.name).toBeGreaterThanOrEqual(1)
      expect(t.floorTicks, t.name).toBeGreaterThanOrEqual(1)
    }
  })
  it('golden run is a complete test1 lap above the floor', () => {
    const run = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'))
    const row = table.find((t) => t.name === run.track)!
    expect(run.checkpointTicks).toHaveLength(row.checkpoints)
    expect(run.totalTicks).toBeGreaterThanOrEqual(row.floorTicks)
    expect(run.ghost.ms).toBe((run.totalTicks * 1000) / TICK_HZ)
  })
})
