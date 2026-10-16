// Best-run ghost: record per-tick CarInput of each lap, keep the session's fastest run in memory,
// replay it by re-simulating through the deterministic physics step.
// Pure TypeScript: no three.js, no clocks, no randomness.
import { FLAT, step, type CarInput, type CarState, type Surface } from '../physics'
import type { RaceEvents } from '../race/lap'

export type GhostRun = {
  start: CarState // car state at lapStart, the replay's spawn state
  inputs: CarInput[] // one entry per tick after lapStart, through lapFinish
  lapTimeMs: number
}

type Finish = { tick: number; lapTimeMs: number }

// The race emits lap events from inside a frame that advances several ticks with one input,
// so the recorder is fed per frame (`frame`) and counts ticks itself. A lap with a respawn or
// restart teleports the car and cannot be replayed, so it is dropped.
export class GhostRecorder {
  private start: CarState | null = null
  private inputs: CarInput[] = []
  private finish: Finish | null = null
  best: GhostRun | null = null

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
    if (!this.start) return
    const end = this.finish ? this.finish.tick : Infinity
    if (this.start.tick + this.inputs.length < end) this.inputs.push({ ...input })
    this.commitIfComplete()
  }

  // Call once per frame after the race advanced the sim to `toTick` with `input`.
  frame(input: CarInput, toTick: number): void {
    if (!this.start) return
    const end = Math.min(toTick, this.finish ? this.finish.tick : Infinity)
    while (this.start && this.start.tick + this.inputs.length < end) this.record(input)
    this.commitIfComplete()
  }

  private commitIfComplete(): void {
    if (!this.start || !this.finish || this.start.tick + this.inputs.length < this.finish.tick) return
    if (!this.best || this.finish.lapTimeMs < this.best.lapTimeMs) this.best = { start: this.start, inputs: this.inputs, lapTimeMs: this.finish.lapTimeMs }
    this.drop()
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
  }

  get done(): boolean {
    return this.tick >= this.run.inputs.length
  }

  // Advance one physics tick; holds the final state once the run is exhausted.
  advance(): CarState {
    if (!this.done) this.state = step(this.state, this.run.inputs[this.tick++], this.surface)
    return this.state
  }

  // Advance until the replay reaches `ticksSinceStart` ticks after its lapStart.
  advanceTo(ticksSinceStart: number): CarState {
    while (!this.done && this.tick < ticksSinceStart) this.advance()
    return this.state
  }
}
