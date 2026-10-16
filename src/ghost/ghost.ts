// Best-run ghost: record per-tick CarInput of each lap, keep the best run in memory,
// replay it by re-simulating through the deterministic physics step.
// Pure TypeScript: no three.js, no clocks, no randomness.
import { step, type CarInput, type CarState } from '../physics'

export type GhostRun = {
  start: CarState // car state at lapStart, the replay's spawn state
  inputs: CarInput[] // one entry per tick from lapStart to lapFinish
  lapTimeMs: number
}

// Wired to src/race events: lapStart(tick), lapFinish(tick, lapTimeMs, isNewBest).
export class GhostRecorder {
  private start: CarState | null = null
  private inputs: CarInput[] = []
  best: GhostRun | null = null

  lapStart(car: CarState): void {
    this.start = car
    this.inputs = []
  }

  // Call once per physics tick with the input fed to step().
  record(input: CarInput): void {
    if (this.start) this.inputs.push({ ...input })
  }

  lapFinish(lapTimeMs: number, isNewBest: boolean): void {
    if (this.start && isNewBest) this.best = { start: this.start, inputs: this.inputs, lapTimeMs }
    this.start = null
    this.inputs = []
  }
}

export class GhostReplayer {
  private tick = 0
  state: CarState

  private readonly run: GhostRun

  constructor(run: GhostRun) {
    this.run = run
    this.state = run.start
  }

  get done(): boolean {
    return this.tick >= this.run.inputs.length
  }

  // Advance one physics tick; holds the final state once the run is exhausted.
  advance(): CarState {
    if (!this.done) this.state = step(this.state, this.run.inputs[this.tick++])
    return this.state
  }
}
