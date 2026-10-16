// Lap loop: countdown, ordered checkpoint gates, lap timer, finish, respawn.
// Pure and tick-driven (100 Hz physics ticks), so it is deterministic and testable.
import { createCarAt, TICK_HZ, TRACK_WIDTH, type CarState, type Vec3 } from '../physics'
import { poses, type Pose, type Track } from '../track/schema'

export const COUNTDOWN_TICKS = 3 * TICK_HZ
/** Half the gate width in metres: a crossing counts within this lateral distance of the gate centre. */
export const GATE_HALF_WIDTH = TRACK_WIDTH / 2 + 1

export type Phase = 'countdown' | 'racing' | 'finished'

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
  phase: Phase = 'countdown'
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
  private countdownEndTick = COUNTDOWN_TICKS

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

  /** Ticks remaining in the countdown (0 once racing). */
  countdownLeft(tick: number): number {
    return Math.max(0, this.countdownEndTick - tick)
  }

  /** Elapsed lap time in ms at `tick` (frozen once finished). */
  lapTimeMs(tick: number): number {
    if (this.phase === 'countdown') return 0
    const end = this.phase === 'finished' ? this.finishTick : tick
    return ((end - this.startTick) * 1000) / TICK_HZ
  }

  /** True while the car must be held at the start line. */
  get frozen(): boolean {
    return this.phase === 'countdown'
  }

  /** Advance one physics tick with the car's state after that tick. */
  update(car: CarState): void {
    const tick = car.tick
    if (this.phase === 'countdown') {
      if (tick >= this.countdownEndTick) {
        this.phase = 'racing'
        this.startTick = tick
        this.lastPosition = car.position
        this.emit((l) => l.lapStart?.(tick))
      }
      return
    }
    if (this.phase !== 'racing') return
    const prev = this.lastPosition ?? car.position
    this.lastPosition = car.position
    if (this.passed < this.checkpoints.length) {
      if (crosses(this.checkpoints[this.passed].pose, prev, car.position)) {
        this.passed++
        const index = this.passed
        this.emit((l) => l.checkpoint?.(tick, index))
      }
      return
    }
    if (crosses(this.finish.pose, prev, car.position)) {
      this.phase = 'finished'
      this.finishTick = tick
      const ms = this.lapTimeMs(tick)
      const best = this.isNewBest(ms)
      this.emit((l) => l.lapFinish?.(tick, ms, best))
    }
  }

  /** Car state at the last passed checkpoint (start line before the first), at rest. */
  respawn(tick: number): CarState {
    const pose = this.passed === 0 ? this.track.start : this.checkpoints[this.passed - 1].pose
    const car = { ...createCarAt(pose), tick }
    this.lastPosition = car.position
    this.emit((l) => l.respawn?.(tick))
    return car
  }

  /** Back to the countdown at the start line; `tick` is the current tick. */
  restart(tick: number): CarState {
    this.phase = 'countdown'
    this.passed = 0
    this.lastPosition = null
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
