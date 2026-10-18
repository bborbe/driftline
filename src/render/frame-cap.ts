// Frame cap: a render-rate limit for the setAnimationLoop callbacks (race and live menu), Settings → Graphics → Frame
// cap or `?fps=` (0 = uncapped). It gates whole callbacks: a skipped one does nothing, the next rendered one gets the
// full elapsed time, so the fixed 100 Hz physics step sees the same simulated time and lap times and replays are
// identical under every cap. Idle screens hold a lower ceiling whatever the cap; a hidden tab renders nothing.
// Quality presets never change the cap. Pure and tested.

/** Frame-cap choices, uncapped first (0 = no cap). */
export const FRAME_CAPS = [0, 120, 60, 30] as const
export const FRAME_CAP_LABELS: Record<(typeof FRAME_CAPS)[number], string> = { 0: 'Uncapped', 120: '120 fps', 60: '60 fps', 30: '30 fps' }
/** The stored cap when it is one of FRAME_CAPS, else uncapped. */
export const clampFrameCap = (v: unknown): number => ((FRAME_CAPS as readonly unknown[]).includes(v) ? (v as number) : 0)

/** Ceiling on the screens where nothing races: the Begin prompt, the Esc menu (and its settings), the results card. */
export const IDLE_FPS = 15
/** Ceiling on the live 3D start menu: a slow turntable needs no more. Its settings panel drops to IDLE_FPS. */
export const MENU_FPS = 30

/** The rate to hold: the player's `cap` lowered to the screen's `ceiling` (0 on either side: no limit from it). */
export function effectiveCap(cap: number, ceiling: number): number {
  if (ceiling <= 0) return cap
  return cap <= 0 ? ceiling : Math.min(cap, ceiling)
}

/** Early allowance, ms: vsync jitter must not push a due frame to the next vsync (30 on 60 Hz stays 30, not 20). */
const SLACK_MS = 2

/** Decides per animation-frame callback whether it renders. One per loop. */
export class FrameGate {
  private next = -Infinity

  /** True when the callback at `now` (ms) renders under `fps` (0: every callback); never while `hidden`. */
  due(now: number, fps: number, hidden = false): boolean {
    if (hidden) return false
    if (fps <= 0) {
      this.next = -Infinity
      return true
    }
    if (now < this.next - SLACK_MS) return false
    const interval = 1000 / fps
    // Phase-locked to the schedule so the average holds; after a stall (or a cap change) restart from now.
    this.next = this.next + interval < now ? now + interval : this.next + interval
    return true
  }
}
