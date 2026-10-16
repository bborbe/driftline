// Frame-time statistics for the HUD "1% low": the 1st percentile of per-frame fps over a sliding window.
export const STATS_WINDOW_S = 60

export class FrameStats {
  private times: number[] = [] // ms timestamps
  private fps: number[] = []

  private readonly windowS: number

  constructor(windowS = STATS_WINDOW_S) {
    this.windowS = windowS
  }

  /** Record one frame that ended at `nowMs` and took `dtS` seconds. */
  push(nowMs: number, dtS: number): void {
    if (dtS <= 0) return
    this.times.push(nowMs)
    this.fps.push(1 / dtS)
    let drop = 0
    while (drop < this.times.length && nowMs - this.times[drop] > this.windowS * 1000) drop++
    if (drop > 0) {
      this.times.splice(0, drop)
      this.fps.splice(0, drop)
    }
  }

  get count(): number {
    return this.fps.length
  }

  /** 1st percentile of per-frame fps in the window; 0 with no samples. Sorts, so call it a few times a second, not per frame. */
  onePercentLow(): number {
    if (this.fps.length === 0) return 0
    const sorted = [...this.fps].sort((a, b) => a - b)
    return sorted[Math.floor((sorted.length - 1) * 0.01)]
  }

  average(): number {
    return this.fps.length === 0 ? 0 : this.fps.reduce((a, b) => a + b, 0) / this.fps.length
  }
}
