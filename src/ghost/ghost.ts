// Best-run ghost: record per-tick CarInput of each lap, keep the session's fastest run in memory,
// replay it by re-simulating through the deterministic physics step.
// Pure TypeScript: no three.js, no clocks, no randomness.
import { FLAT, interpolate, step, type CarInput, type CarState, type FedInput, type Surface } from '../physics'
import type { RaceEvents } from '../race/lap'

export type GhostRun = {
  start: CarState // car state at lapStart, the replay's spawn state
  inputs: CarInput[] // one entry per tick after lapStart, through lapFinish
  lapTimeMs: number
}

type Finish = { tick: number; lapTimeMs: number }

// The race emits lap events from inside a frame that advances several ticks with one input,
// so the recorder is fed per frame (`frame`) and counts ticks itself. A lap with a respawn or
// restart teleports the car and cannot be replayed, so it is dropped. In a multi-lap run the next lap
// starts on the same tick the last one finished, before that frame's inputs are recorded, so the
// finished lap waits in `pending` until its inputs are complete.
export class GhostRecorder {
  private start: CarState | null = null
  private inputs: CarInput[] = []
  private finish: Finish | null = null
  private pending: { start: CarState; inputs: CarInput[]; finish: Finish } | null = null
  best: GhostRun | null = null
  /** While true (a dev-tuned run, src/debug/tuning.ts) finished laps are dropped, never kept as the ghost. */
  locked: () => boolean = () => false
  /** Hears every finished lap the recorder keeps, not only a new best (the online leaderboard submits it, src/leaderboard). */
  onKeep: ((run: GhostRun) => void) | null = null

  // Race listener; `car` returns the sim state at the moment the event fires.
  listener(car: () => CarState): RaceEvents {
    return {
      lapStart: () => this.lapStart(car()),
      // The race's isNewBest compares against the persisted all-time best, so a session
      // slower than an old record would never get a ghost; keep the session's fastest instead.
      lapFinish: (tick, ms) => this.lapFinish(tick, ms),
      respawn: () => this.drop(),
    }
  }

  lapStart(car: CarState): void {
    if (this.start && this.finish) this.pending = { start: this.start, inputs: this.inputs, finish: this.finish }
    this.start = car
    this.inputs = []
    this.finish = null
  }

  lapFinish(tick: number, lapTimeMs: number): void {
    if (!this.start) return
    this.finish = { tick, lapTimeMs }
    this.commitIfComplete()
  }

  drop(): void {
    this.start = null
    this.inputs = []
    this.finish = null
  }

  // Call once per physics tick with the input fed to step().
  record(input: CarInput): void {
    if (this.pending) {
      const p = this.pending
      if (p.start.tick + p.inputs.length < p.finish.tick) p.inputs.push({ ...input })
      this.commitPending()
      return
    }
    if (!this.start) return
    const end = this.finish ? this.finish.tick : Infinity
    if (this.start.tick + this.inputs.length < end) this.inputs.push({ ...input })
    this.commitIfComplete()
  }

  // Call once per frame after the race advanced the sim, with the inputs it fed to step() that frame
  // (`FixedStepper.fed`): one per tick, so effect pads that gate the input mid-frame record exactly.
  // An input counts only if it was fed from the next tick the run is missing, so ticks before a
  // mid-frame lapStart (and a stale `fed` from a frame that did not advance) are skipped.
  consume(fed: readonly FedInput[]): void {
    for (const { tick, input } of fed) {
      const p = this.pending
      if (p) {
        if (tick === p.start.tick + p.inputs.length && tick < p.finish.tick) p.inputs.push({ ...input })
        this.commitPending()
      }
      if (!this.start) continue
      const end = this.finish ? this.finish.tick : Infinity
      if (tick === this.start.tick + this.inputs.length && tick < end) this.inputs.push({ ...input })
      this.commitIfComplete()
    }
  }

  // Call once per frame after the race advanced the sim to `toTick` with `input`.
  frame(input: CarInput, toTick: number): void {
    const p = this.pending
    if (p) {
      while (p.start.tick + p.inputs.length < Math.min(toTick, p.finish.tick)) p.inputs.push({ ...input })
      this.commitPending()
    }
    if (!this.start) return
    const end = Math.min(toTick, this.finish ? this.finish.tick : Infinity)
    while (this.start && this.start.tick + this.inputs.length < end) this.record(input)
    this.commitIfComplete()
  }

  private commitIfComplete(): void {
    if (!this.start || !this.finish || this.start.tick + this.inputs.length < this.finish.tick) return
    this.keep(this.start, this.inputs, this.finish)
    this.start = null
    this.inputs = []
    this.finish = null
  }

  private commitPending(): void {
    const p = this.pending
    if (!p || p.start.tick + p.inputs.length < p.finish.tick) return
    this.pending = null
    this.keep(p.start, p.inputs, p.finish)
  }

  private keep(start: CarState, inputs: CarInput[], finish: Finish): void {
    if (this.locked()) return
    const run = { start, inputs, lapTimeMs: finish.lapTimeMs }
    if (!this.best || run.lapTimeMs < this.best.lapTimeMs) this.best = run
    this.onKeep?.(run)
  }
}

export class GhostReplayer {
  private tick = 0
  state: CarState
  private readonly run: GhostRun
  private readonly surface: Surface

  constructor(run: GhostRun, surface: Surface = FLAT) {
    this.run = run
    this.surface = surface
    this.state = run.start
    this.previous = run.start
  }

  get done(): boolean {
    return this.tick >= this.run.inputs.length
  }

  // Advance one physics tick; holds the final state once the run is exhausted.
  advance(): CarState {
    this.previous = this.state
    if (!this.done) this.state = step(this.state, this.run.inputs[this.tick++], this.surface)
    return this.state
  }

  // Pose to draw, blended by the live sim's `alpha` so the ghost moves as evenly as the car.
  render(alpha: number): CarState {
    return interpolate(this.previous, this.state, alpha)
  }

  private previous: CarState

  // Advance until the replay reaches `ticksSinceStart` ticks after its lapStart.
  advanceTo(ticksSinceStart: number): CarState {
    while (!this.done && this.tick < ticksSinceStart) this.advance()
    return this.state
  }
}
