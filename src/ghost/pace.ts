// Medal pace ghosts. No gold or author run is recorded anywhere, so the autopilot laps the track once through the
// real lap loop and physics (as the end-to-end lap tests drive it), and that lap replays time-scaled so it crosses
// the line exactly at the medal time: its line is the autopilot's, its pace the medal's.
// Pure TypeScript: no three.js, no clocks, no randomness.
import { FixedStepper, interpolate, NO_INPUT, TICK_HZ, trackSurface, type CarState } from '../physics'
import { autopilot, centreline, hasLoop, surfaceLine } from '../race/autopilot'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from '../race/lap'
import { STYLES } from '../track/catalogue'
import type { Track } from '../track/schema'

const TICK_MS = 1000 / TICK_HZ

/** Longest autopilot lap tried before the track gets no medal ghosts (the slowest shipped lap is ~85 s). */
export const PACE_LAP_LIMIT_TICKS = 120 * TICK_HZ

export interface PaceLap {
  /** Car state at GO (index 0), then one per tick through the finish. */
  states: CarState[]
  /** Lap time at each checkpoint (ms). */
  splits: number[]
  lapMs: number
}

/**
 * One autopilot lap of `track` from GO to the line, on the line the lap tests drive (surface-aware on the style
 * tracks), or null when it respawns or does not finish within PACE_LAP_LIMIT_TICKS.
 */
export function recordPaceLap(track: Track): PaceLap | null {
  const loop = new LapLoop(track, () => false)
  const sim = new FixedStepper(loop.spawn(), trackSurface(track))
  const drive = autopilot((STYLES.some((l) => l.track === track.name) ? surfaceLine : centreline)(track), 0, hasLoop(track))
  let startTick = -1
  let lapMs = -1
  let respawned = false
  const splits: number[] = []
  const states: CarState[] = []
  loop.on({
    lapStart: (tick) => (startTick = tick),
    checkpoint: (tick) => void splits.push((tick - startTick) * TICK_MS),
    lapFinish: (_tick, ms) => (lapMs = ms),
    respawn: () => (respawned = true),
  })
  loop.start(sim.state.tick)
  for (let n = 0; n < COUNTDOWN_TICKS + PACE_LAP_LIMIT_TICKS && lapMs < 0 && !respawned; n++) {
    advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
    if (startTick >= 0) states.push(sim.state)
  }
  return lapMs > 0 && !respawned ? { states, splits, lapMs } : null
}

/** A pace lap replayed at the medal time `targetMs`: every split and the finish scale by the same factor. */
export class PaceGhost {
  readonly splits: number[]
  readonly lapMs: number
  private readonly lap: PaceLap
  private readonly scale: number

  constructor(lap: PaceLap, targetMs: number) {
    this.lap = lap
    this.scale = lap.lapMs / targetMs
    this.splits = lap.splits.map((ms) => ms / this.scale)
    this.lapMs = targetMs
  }

  /** Pose `ticks` (fractional) after GO: on the grid before it, at rest on the line after its finish. */
  at(ticks: number): CarState {
    const last = this.lap.states.length - 1
    const u = Math.min(last, Math.max(0, ticks * this.scale))
    const i = Math.floor(u)
    if (u === i) return this.lap.states[i]
    return interpolate(this.lap.states[i], this.lap.states[Math.min(last, i + 1)], u - i)
  }
}
