// Lap loop: wait for Begin, countdown, ordered checkpoint gates, lap timer, finish, respawn
// (manual, or automatic when the car falls out of the world).
// Pure and tick-driven (100 Hz physics ticks), so it is deterministic and testable.
import {
  createCarAt, NO_INPUT, TICK_HZ, TRACK_WIDTH, wheelContacts, type CarInput, type CarState, type FixedStepper, type Vec3,
} from '../physics'
import { gateLine, type Pose, type Track } from '../track/schema'

export const COUNTDOWN_TICKS = 3 * TICK_HZ
/** Restart (Backspace) skips the full 3-2-1: control is back in under a second. */
export const RESTART_COUNTDOWN_TICKS = Math.round(0.8 * TICK_HZ)
/** Half the gate width in metres: a crossing counts within this lateral distance of the gate centre. */
export const GATE_HALF_WIDTH = TRACK_WIDTH / 2 + 1
/** Ground plane height of the track surface (trackSurface's default groundY). */
export const GROUND_Y = 0
/** Auto-respawn when the car drops this far below the ground plane. */
export const FALL_DEPTH = 5
/** Auto-respawn after this many ticks with no wheel on any surface (normal jumps last < 2 s). */
export const MAX_AIRBORNE_TICKS = 3 * TICK_HZ
/** Upper bound for `?laps=N`. */
export const MAX_LAPS = 10

/** A whole lap count in 1..MAX_LAPS, or `fallback` for anything else. */
export const clampLaps = (n: unknown, fallback = 1): number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_LAPS) : fallback

/** Lap count: `?laps=N` wins when valid (shared links), else `fallback` (the saved setting); capped at MAX_LAPS. */
export function lapCount(search: string, fallback = 1): number {
  const q = new URLSearchParams(search).get('laps')
  return clampLaps(q === null || q === '' ? NaN : Number(q), fallback)
}

export type Phase = 'ready' | 'countdown' | 'racing' | 'finished'

export interface RaceEvents {
  /** Start countdown: 3, 2, 1 as each second begins, then 0 on GO. */
  countdown?(tick: number, n: number): void
  /** Each lap's start: GO for lap 1, the start/finish crossing for later laps. `lap` is 1-based. */
  lapStart?(tick: number, lap: number): void
  /** Checkpoint `index` (1-based, per lap) passed. */
  checkpoint?(tick: number, index: number): void
  /** A lap crossed the start/finish line; `lapTimeMs` is that lap alone. Fires for every lap, the last included. */
  lapFinish?(tick: number, lapTimeMs: number, lap: number): void
  /** The run is over after the last lap: total time, whether it beats the stored best, each lap's time. */
  raceFinish?(tick: number, totalMs: number, isNewBest: boolean, lapTimes: number[]): void
  respawn?(tick: number): void
  /** Backspace restart: the car is back on the start line, the short countdown begins. */
  restart?(tick: number): void
}

interface GatePose {
  pose: Pose
}

export class LapLoop {
  phase: Phase = 'ready'
  /** Checkpoints passed this lap (0..checkpoints.length). */
  passed = 0
  /** Current lap, 1-based (1..laps). */
  lap = 1
  /** Times (ms) of the laps finished so far this run. */
  lapTimes: number[] = []
  readonly laps: number

  /** Fastest lap finished this run (ms), null before the first one; cleared by restart. */
  get runBestMs(): number | null {
    return this.lapTimes.length === 0 ? null : Math.min(...this.lapTimes)
  }
  private startTick = 0
  private lapStartTick = 0
  private finishTick = 0
  private lastPosition: Vec3 | null = null
  private readonly checkpoints: GatePose[]
  private readonly finish: GatePose
  private readonly listeners: RaceEvents[] = []

  private readonly track: Track
  private readonly isNewBest: (totalMs: number) => boolean
  private countdownEndTick = 0
  private lastCountdown = -1
  private airborneTicks = 0
  private lastTick = 0

  /** `isNewBest` judges the run's total time; `laps` is the number of laps in a run (default 1). */
  constructor(track: Track, isNewBest: (totalMs: number) => boolean, laps = 1) {
    this.track = track
    this.isNewBest = isNewBest
    this.laps = laps
    this.checkpoints = track.gates.filter((g) => g.kind === 'checkpoint').map((g) => ({ pose: gateLine(track, g) }))
    const sf = track.gates.find((g) => g.kind === 'start-finish')
    this.finish = { pose: sf ? gateLine(track, sf) : track.start }
  }

  on(events: RaceEvents): void {
    this.listeners.push(events)
  }

  get checkpointCount(): number {
    return this.checkpoints.length
  }

  /** Car state at the start line, at rest. */
  spawn(): CarState {
    return createCarAt(this.track.start)
  }

  /** Begin pressed: start the countdown from `tick`. No-op unless waiting at the start. */
  start(tick: number): void {
    if (this.phase !== 'ready') return
    this.phase = 'countdown'
    this.countdownEndTick = tick + COUNTDOWN_TICKS
    this.announceCountdown(tick)
  }

  /** Ticks remaining in the countdown (0 outside it). */
  countdownLeft(tick: number): number {
    return this.phase === 'countdown' ? Math.max(0, this.countdownEndTick - tick) : 0
  }

  /** Elapsed run time in ms at `tick`, all laps so far (0 before go, frozen once finished). */
  lapTimeMs(tick: number): number {
    if (this.phase === 'ready' || this.phase === 'countdown') return 0
    const end = this.phase === 'finished' ? this.finishTick : tick
    return ((end - this.startTick) * 1000) / TICK_HZ
  }

  /** The player's input while racing; no input before go (Begin + countdown) and after the finish. */
  input(raw: CarInput): CarInput {
    return this.phase === 'racing' ? raw : NO_INPUT
  }

  /**
   * Advance with the car's state after the latest physics tick(s) and how many wheels touch a
   * surface. Returns a respawned car when it fell out of the world, else null.
   */
  update(car: CarState, wheelContacts = 4): CarState | null {
    const tick = car.tick
    const ticks = Math.max(0, tick - this.lastTick)
    this.lastTick = tick
    if (this.phase === 'countdown') {
      this.announceCountdown(tick)
      if (tick >= this.countdownEndTick) {
        this.phase = 'racing'
        this.startTick = tick
        this.lapStartTick = tick
        this.lastPosition = car.position
        this.airborneTicks = 0
        this.emit((l) => l.lapStart?.(tick, 1))
      }
      return null
    }
    if (this.phase !== 'racing') return null
    this.airborneTicks = wheelContacts === 0 ? this.airborneTicks + ticks : 0
    if (car.position.y < GROUND_Y - FALL_DEPTH || this.airborneTicks > MAX_AIRBORNE_TICKS) {
      return this.respawn(tick)
    }
    const prev = this.lastPosition ?? car.position
    this.lastPosition = car.position
    if (this.passed < this.checkpoints.length) {
      if (crosses(this.checkpoints[this.passed].pose, prev, car.position)) {
        this.passed++
        const index = this.passed
        this.emit((l) => l.checkpoint?.(tick, index))
      }
      return null
    }
    if (crosses(this.finish.pose, prev, car.position)) {
      const lap = this.lap
      const lapMs = ((tick - this.lapStartTick) * 1000) / TICK_HZ
      this.lapTimes = [...this.lapTimes, lapMs]
      this.emit((l) => l.lapFinish?.(tick, lapMs, lap))
      if (lap < this.laps) {
        this.lap++
        this.passed = 0
        this.lapStartTick = tick
        this.emit((l) => l.lapStart?.(tick, lap + 1))
        return null
      }
      this.phase = 'finished'
      this.finishTick = tick
      const total = this.lapTimeMs(tick)
      const best = this.isNewBest(total)
      const times = this.lapTimes
      this.emit((l) => l.raceFinish?.(tick, total, best, times))
    }
    return null
  }

  /** Car state at the current lap's last passed checkpoint (start line before the first), at rest. */
  respawn(tick: number): CarState {
    const pose = this.passed === 0 ? this.track.start : this.checkpoints[this.passed - 1].pose
    const car = { ...createCarAt(pose), tick }
    this.lastPosition = car.position
    this.airborneTicks = 0
    this.emit((l) => l.respawn?.(tick))
    return car
  }

  /** Back to a short countdown at the start line, lap 1; `tick` is the current tick. */
  restart(tick: number): CarState {
    if (this.phase === 'ready') return { ...this.spawn(), tick } // still waiting for Begin
    this.phase = 'countdown'
    this.passed = 0
    this.lap = 1
    this.lapTimes = []
    this.lastPosition = null
    this.airborneTicks = 0
    this.countdownEndTick = tick + RESTART_COUNTDOWN_TICKS
    this.lastCountdown = -1
    this.emit((l) => l.restart?.(tick))
    this.announceCountdown(tick)
    return { ...this.spawn(), tick }
  }

  // Emits countdown(n) once per whole second left: 3 at the start, 2, 1, then 0 on GO.
  private announceCountdown(tick: number): void {
    const n = Math.ceil(Math.max(0, this.countdownEndTick - tick) / TICK_HZ)
    if (n === this.lastCountdown) return
    this.lastCountdown = n
    this.emit((l) => l.countdown?.(tick, n))
  }

  private emit(fn: (l: RaceEvents) => void): void {
    for (const l of this.listeners) fn(l)
  }
}

/**
 * One frame of the race against the car sim: advance the physics with the gated input, update
 * lap state, apply an auto-respawn. While the finish panel is up the car is frozen where it
 * crossed the line instead of coasting off the track behind the panel. Returns the respawned
 * car, if any. This is the whole per-frame race step; race.frame() and the tests both use it.
 */
// Paused: nothing advances — no tick, no accumulator, no lap/timer update — so resuming continues tick-exact.
export function advanceRace(loop: LapLoop, sim: FixedStepper, elapsedSeconds: number, raw: CarInput, paused = false): CarState | null {
  if (paused) return null
  if (loop.phase !== 'finished') sim.advance(elapsedSeconds, loop.input(raw))
  const respawned = loop.update(sim.state, wheelContacts(sim.state, sim.surface))
  if (respawned) sim.state = respawned
  return respawned
}

/** Did the segment prev→cur cross the gate plane forwards, within the gate width? */
export function crosses(gate: Pose, prev: Vec3, cur: Vec3): boolean {
  const fx = Math.sin(gate.heading)
  const fz = Math.cos(gate.heading)
  const before = (prev.x - gate.x) * fx + (prev.z - gate.z) * fz
  const after = (cur.x - gate.x) * fx + (cur.z - gate.z) * fz
  if (!(before < 0 && after >= 0)) return false
  const t = before / (before - after)
  const x = prev.x + (cur.x - prev.x) * t - gate.x
  const z = prev.z + (cur.z - prev.z) * t - gate.z
  return Math.abs(x * fz - z * fx) <= GATE_HALF_WIDTH
}
