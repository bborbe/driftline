// Start sequence state: what the start lights and the start arch's screens show. Pure, so the HUD
// lights (view.ts) and the 3D arch (src/render/track/start-dressing.ts) read one mapping.
import type { Phase } from './lap'

export type Lamp = 'off' | 'red' | 'green'

/** Lights per start light: red, red, red, then all green. */
export const LAMPS = 3

/**
 * Countdown step → lamps. `step` is the countdown event's n (3, 2, 1, then 0 on GO), or null
 * before the first step: one more red per step, all green on GO.
 */
export function startLamps(step: number | null): Lamp[] {
  return Array.from({ length: LAMPS }, (_, i): Lamp => {
    if (step === null) return 'off'
    if (step <= 0) return 'green'
    return i < LAMPS + 1 - step ? 'red' : 'off'
  })
}

/** Band under the arch timer: READY while waiting, the step during the countdown, GO! once racing. */
export type Band = 'ready' | 'count' | 'go' | 'finish'

export interface StartBoard {
  lamps: Lamp[]
  /** Run time as the arch screen prints it (tenths, so the texture redraws at most 10×/s). */
  timer: string
  band: Band
  bandText: string
}

/** Run time as m:ss.t; tenths are truncated, never rounded up past the HUD's own time. */
export function boardTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}

/** What the start lights and arch screens show for a race phase, the last countdown step and the run time. */
export function startBoard(phase: Phase, step: number | null, runMs: number): StartBoard {
  switch (phase) {
    case 'ready':
      return { lamps: startLamps(null), timer: boardTime(0), band: 'ready', bandText: 'READY' }
    case 'countdown':
      return { lamps: startLamps(step), timer: boardTime(0), band: 'count', bandText: step === null ? '' : String(step) }
    case 'racing':
      return { lamps: startLamps(0), timer: boardTime(runMs), band: 'go', bandText: 'GO!' }
    case 'finished':
      return { lamps: startLamps(0), timer: boardTime(runMs), band: 'finish', bandText: 'FINISH' }
  }
}
