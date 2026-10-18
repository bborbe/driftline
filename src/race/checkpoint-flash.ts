// Checkpoint flash: a brief glow around the screen edge on every checkpoint and lap-line pass, tinted like the split
// delta (blue ahead, red behind, white without a best). Pure timing here; view.ts owns the element. Not a physics input.

/** How long the flash lasts, seconds. */
export const CHECKPOINT_FLASH_S = 0.8
/** The flash peaks at this fraction of its life: a fast rise, then a longer fade. */
const PEAK = 0.15

/** Flash opacity `t` seconds after the pass: 0 → 1 by PEAK, back to 0 at CHECKPOINT_FLASH_S, 0 outside. */
export const flashOpacity = (t: number): number => {
  if (t <= 0 || t >= CHECKPOINT_FLASH_S) return 0
  const peak = PEAK * CHECKPOINT_FLASH_S
  return t < peak ? t / peak : 1 - (t - peak) / (CHECKPOINT_FLASH_S - peak)
}

/** One flash at a time; a pass during a flash restarts it. Time is in seconds from any monotonic clock. */
export class CheckpointFlash {
  private start: number | null = null

  trigger(nowS: number): void {
    this.start = nowS
  }

  opacity(nowS: number): number {
    if (this.start === null) return 0
    const o = flashOpacity(nowS - this.start)
    if (nowS - this.start >= CHECKPOINT_FLASH_S) this.start = null
    return o
  }
}
