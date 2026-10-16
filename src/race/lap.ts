// Lap loop: wait for Begin, countdown, ordered checkpoint gates, lap timer, finish, respawn
// (manual, or automatic when the car falls out of the world).
// Pure and tick-driven (100 Hz physics ticks), so it is deterministic and testable.
import { createCarAt, NO_INPUT, TICK_HZ, TRACK_WIDTH, type CarInput, type CarState, type Vec3 } from '../physics'
import { poses, type Pose, type Track } from '../track/schema'

export const COUNTDOWN_TICKS = 3 * TICK_HZ
/** Half the gate width in metres: a crossing counts within this lateral distance of the gate centre. */
export const GATE_HALF_WIDTH = TRACK_WIDTH / 2 + 1
/** Ground plane height of the track surface (trackSurface's default groundY). */
export const GROUND_Y = 0
/** Auto-respawn when the car drops this far below the ground plane. */
export const FALL_DEPTH = 5
/** Auto-respawn after this many ticks with no wheel on any surface (normal jumps last < 2 s). */
export const MAX_AIRBORNE_TICKS = 3 * TICK_HZ

export type Phase = 'ready' | 'countdown' | 'racing' | 'finished'

export interface RaceEvents {
  lapStart?(tick: number): void
  checkpoint?(tick: number, index: number): void
  lapFinish?(tick: number, lapTimeMs: number, isNewBest: boolean): void
  respawn?(tick: number): void
}

interface GatePose {
  pose: Pose
}

export class LapLoop {
  phase: Phase = 'ready'
  /** Checkpoints passed this lap (0..checkpoints.length). */
  passed = 0
  private startTick = 0
  private finishTick = 0
  private lastPosition: Vec3 | null = null
  private readonly checkpoints: GatePose[]
  private readonly finish: GatePose
  private readonly listeners: RaceEvents[] = []

  private readonly track: Track
  private readonly isNewBest: (lapTimeMs: number) => boolean
  private countdownEndTick = 0
  private airborneTicks = 0
  private lastTick = 0

  constructor(track: Track, isNewBest: (lapTimeMs: number) => boolean) {
    this.track = track
    this.isNewBest = isNewBest
    const p = poses(track)
    this.checkpoints = track.gates.filter((g) => g.kind === 'checkpoint').map((g) => ({ pose: p[g.segment] }))
    const sf = track.gates.find((g) => g.kind === 'start-finish')
    this.finish = { pose: sf ? p[sf.segment] : track.start }
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
  }

  /** Ticks remaining in the countdown (0 outside it). */
  countdownLeft(tick: number): number {
    return this.phase === 'countdown' ? Math.max(0, this.countdownEndTick - tick) : 0
  }

  /** Elapsed lap time in ms at `tick` (0 before go, frozen once finished). */
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
      if (tick >= this.countdownEndTick) {
        this.phase = 'racing'
        this.startTick = tick
        this.lastPosition = car.position
        this.airborneTicks = 0
        this.emit((l) => l.lapStart?.(tick))
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
      this.phase = 'finished'
      this.finishTick = tick
      const ms = this.lapTimeMs(tick)
      const best = this.isNewBest(ms)
      this.emit((l) => l.lapFinish?.(tick, ms, best))
    }
    return null
  }

  /** Car state at the last passed checkpoint (start line before the first), at rest. */
  respawn(tick: number): CarState {
    const pose = this.passed === 0 ? this.track.start : this.checkpoints[this.passed - 1].pose
    const car = { ...createCarAt(pose), tick }
    this.lastPosition = car.position
    this.airborneTicks = 0
    this.emit((l) => l.respawn?.(tick))
    return car
  }

  /** Back to the countdown at the start line; `tick` is the current tick. */
  restart(tick: number): CarState {
    if (this.phase === 'ready') return { ...this.spawn(), tick } // still waiting for Begin
    this.phase = 'countdown'
    this.passed = 0
    this.lastPosition = null
    this.airborneTicks = 0
    this.countdownEndTick = tick + COUNTDOWN_TICKS
    return { ...this.spawn(), tick }
  }

  private emit(fn: (l: RaceEvents) => void): void {
    for (const l of this.listeners) fn(l)
  }
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
