// Lap loop: wait for Begin, countdown, ordered checkpoint gates, lap timer, finish, respawn
// (manual, or automatic when the car falls out of the world).
// Pure and tick-driven (100 Hz physics ticks), so it is deterministic and testable.
import {
  createCarAt, NO_INPUT, TICK_HZ, TRACK_WIDTH, wheelContacts, type CarInput, type CarState, type FixedStepper, type Surface, type Vec3,
} from '../physics'
import { gateLine, gateUp, gateWidth, type Gate, type Pose, type Track } from '../track/schema'
import { loopTubes, partialPose, poses } from '../track/pose'
import { Effects } from './effects'

/** Steps announced before GO: 3, 2, 1. */
export const COUNTDOWN_STEPS = 3
export const COUNTDOWN_TICKS = COUNTDOWN_STEPS * TICK_HZ
/** Half the gate width on a default-width road, in metres: a crossing counts within this lateral distance of the gate centre. */
export const GATE_HALF_WIDTH = TRACK_WIDTH / 2 + 1
/** Half a gate's width: its road's half width (gateWidth) plus GATE_HALF_WIDTH's 1 m margin. */
export const gateHalfWidth = (track: Track, gate: Gate): number => gateWidth(track, gate) / 2 + 1
/**
 * A crossing counts only from GATE_BELOW under the gate's road to GATE_ABOVE over it, so a road
 * passing under a gate on a deck never triggers it. The upper bound is generous: a full-throttle
 * car clears crossover's landing checkpoint ~9 m up and must still score it. Roads above a gate
 * are kept out by layout instead (src/track/assets.test.ts: no other road within 10 m of a gate).
 */
export const GATE_BELOW = 2
export const GATE_ABOVE = 20
/** Ground plane height of the track surface (trackSurface's default groundY). */
export const GROUND_Y = 0
/** Auto-respawn when the car drops this far below the ground plane. */
export const FALL_DEPTH = 5
/** Auto-respawn after this many ticks with no wheel on any surface (normal jumps last < 2 s). */
export const MAX_AIRBORNE_TICKS = 3 * TICK_HZ
/**
 * Auto-respawn after this many ticks inside a loop with no wheel on the road: the car was too slow
 * and fell off it (src/track/pose.ts loopTubes). Never on a track without a loop.
 */
export const LOOP_FALL_TICKS = 0.3 * TICK_HZ
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
  /** Restart (Backspace, Esc → Restart, finish → Improve): the car is back on the start line, the countdown begins. */
  restart?(tick: number): void
}

interface GatePose {
  pose: Pose
  /** 1 upright, -1 hanging from the road at a loop's top (gateUp). */
  up?: 1 | -1
  /** Where a respawn after this gate puts the car at rest, when not on its line: a loop's exit for its top. */
  respawn?: Pose
  halfWidth: number
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
  private loopFallTicks = 0
  private readonly inLoop: (p: Vec3) => boolean
  private lastTick = 0
  /** Effect pads active this run (src/race/effects.ts); cleared on respawn, restart and the finish. */
  readonly effects = new Effects()

  /** `isNewBest` judges the run's total time; `laps` is the number of laps in a run (default 1). */
  constructor(track: Track, isNewBest: (totalMs: number) => boolean, laps = 1) {
    this.track = track
    this.isNewBest = isNewBest
    this.laps = laps
    const entries = poses(track)
    this.checkpoints = track.gates
      .filter((g) => g.kind === 'checkpoint')
      .map((g) => {
        const up = gateUp(track, g)
        // At rest upside down 30 m up would only fall: past a loop's top, respawn at its exit instead.
        const respawn = up === -1 ? partialPose(entries[g.segment], track.segments[g.segment], 1) : undefined
        return { pose: gateLine(track, g), up, respawn, halfWidth: gateHalfWidth(track, g) }
      })
    const sf = track.gates.find((g) => g.kind === 'start-finish')
    this.finish = sf ? { pose: gateLine(track, sf), halfWidth: gateHalfWidth(track, sf) } : { pose: track.start, halfWidth: GATE_HALF_WIDTH }
    this.inLoop = loopTubes(track)
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
   * The input fed to one physics tick from state `s`: the player's input while racing, with the
   * effect pads applied. While racing, reads the ground under `s` first, so a pad entered this tick
   * already gates it.
   */
  tickInput(raw: CarInput, s: CarState, surface: Surface): CarInput {
    if (this.phase !== 'racing') return NO_INPUT
    this.effects.observe(s, surface)
    return this.effects.gate(raw, s)
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
    this.loopFallTicks = 0
        this.emit((l) => l.lapStart?.(tick, 1))
      }
      return null
    }
    if (this.phase !== 'racing') return null
    this.airborneTicks = wheelContacts === 0 ? this.airborneTicks + ticks : 0
    this.loopFallTicks = wheelContacts === 0 && this.inLoop(car.position) ? this.loopFallTicks + ticks : 0
    if (car.position.y < GROUND_Y - FALL_DEPTH || this.airborneTicks > MAX_AIRBORNE_TICKS || this.loopFallTicks > LOOP_FALL_TICKS) {
      return this.respawn(tick)
    }
    const prev = this.lastPosition ?? car.position
    this.lastPosition = car.position
    if (this.passed < this.checkpoints.length) {
      const gate = this.checkpoints[this.passed]
      if (crosses(gate.pose, prev, car.position, gate.up, gate.halfWidth)) {
        this.passed++
        const index = this.passed
        this.emit((l) => l.checkpoint?.(tick, index))
      }
      return null
    }
    // A free-drive pad (Track.pad) has no finish: the run goes on until restart.
    if (!this.track.pad && crosses(this.finish.pose, prev, car.position, 1, this.finish.halfWidth)) {
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
      this.effects.clear()
      const total = this.lapTimeMs(tick)
      const best = this.isNewBest(total)
      const times = this.lapTimes
      this.emit((l) => l.raceFinish?.(tick, total, best, times))
    }
    return null
  }

  /** Car state at the current lap's last passed checkpoint (start line before the first; a loop's exit for its top), at rest. */
  respawn(tick: number): CarState {
    const last = this.checkpoints[this.passed - 1]
    const pose = this.passed === 0 ? this.track.start : (last.respawn ?? last.pose)
    const car = { ...createCarAt(pose), tick }
    this.lastPosition = car.position
    this.airborneTicks = 0
    this.loopFallTicks = 0
    this.effects.clear()
    this.emit((l) => l.respawn?.(tick))
    return car
  }

  /** Back to the full countdown at the start line, lap 1; `tick` is the current tick. */
  restart(tick: number): CarState {
    if (this.phase === 'ready') return { ...this.spawn(), tick } // still waiting for Begin
    this.phase = 'countdown'
    this.passed = 0
    this.lap = 1
    this.lapTimes = []
    this.lastPosition = null
    this.airborneTicks = 0
    this.loopFallTicks = 0
    this.effects.clear()
    this.countdownEndTick = tick + COUNTDOWN_TICKS
    this.lastCountdown = -1
    this.emit((l) => l.restart?.(tick))
    this.announceCountdown(tick)
    return { ...this.spawn(), tick }
  }

  // Emits countdown(n) once per step: 3 at the start, 2, 1, then 0 on GO, one second apart on every path
  // (Begin and restart alike). Tick-driven, so the steps do not depend on the display frame rate.
  private announceCountdown(tick: number): void {
    const n = Math.ceil((COUNTDOWN_STEPS * Math.max(0, this.countdownEndTick - tick)) / COUNTDOWN_TICKS)
    if (n === this.lastCountdown) return
    this.lastCountdown = n
    this.emit((l) => l.countdown?.(tick, n))
  }

  private emit(fn: (l: RaceEvents) => void): void {
    for (const l of this.listeners) fn(l)
  }
}

/**
 * One frame of the race against the car sim: advance the physics with the gated input (asked per
 * tick, so an effect pad entered mid-frame gates the rest of it), update
 * lap state, apply an auto-respawn. While the finish panel is up the car is frozen where it
 * crossed the line instead of coasting off the track behind the panel. Returns the respawned
 * car, if any. This is the whole per-frame race step; race.frame() and the tests both use it.
 */
// Paused: nothing advances — no tick, no accumulator, no lap/timer update — so resuming continues tick-exact.
export function advanceRace(loop: LapLoop, sim: FixedStepper, elapsedSeconds: number, raw: CarInput, paused = false): CarState | null {
  if (paused) return null
  if (loop.phase !== 'finished') sim.advance(elapsedSeconds, (s) => loop.tickInput(raw, s, sim.surface))
  const respawned = loop.update(sim.state, wheelContacts(sim.state, sim.surface))
  if (respawned) sim.state = respawned
  return respawned
}

/**
 * Did the segment prev→cur cross the gate plane forwards, within the gate width and under its arch?
 * `up` -1 is a gate hanging from its road (a loop's top, gateUp): the window flips below the road.
 * `halfWidth` is the gate's own (gateHalfWidth); default a default-width road's.
 */
export function crosses(gate: Pose, prev: Vec3, cur: Vec3, up: 1 | -1 = 1, halfWidth = GATE_HALF_WIDTH): boolean {
  const fx = Math.sin(gate.heading)
  const fz = Math.cos(gate.heading)
  const before = (prev.x - gate.x) * fx + (prev.z - gate.z) * fz
  const after = (cur.x - gate.x) * fx + (cur.z - gate.z) * fz
  if (!(before < 0 && after >= 0)) return false
  const t = before / (before - after)
  const x = prev.x + (cur.x - prev.x) * t - gate.x
  const z = prev.z + (cur.z - prev.z) * t - gate.z
  const y = up * (prev.y + (cur.y - prev.y) * t - gate.y)
  return Math.abs(x * fz - z * fx) <= halfWidth && y >= -GATE_BELOW && y <= GATE_ABOVE
}
