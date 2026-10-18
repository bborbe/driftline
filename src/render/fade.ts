// Screen fades: one fixed black overlay (#fade) over the canvas and HUD, under the results card and menus. Every
// screen change goes through it — menu → race (fade out, boot, fade in on the first frame), race → results (dim to
// RESULTS_DIM while the card comes in), results / Esc menu → menu or next track (fade to black, then the page load).
// Debug spawns and `freeze=1` shots never fade: the overlay stays at 0 (`noFade`).
export const FADE_MS = 300
/** How dark the scene behind the results card goes. */
export const RESULTS_DIM = 0.45

/** The overlay's style surface; a real element in the game, a plain object in tests. */
export interface FadeTarget {
  style: { opacity: string; transition: string }
}

export interface Fade {
  /** Current target opacity (0 = clear, 1 = black). */
  readonly opacity: number
  /** Transition to `opacity` over `ms`; resolves when it has finished. */
  to(opacity: number, ms?: number): Promise<void>
}

export function createFade(target: FadeTarget, initial: number, wait: (ms: number) => Promise<void> = sleep): Fade {
  let opacity = initial
  target.style.transition = 'none'
  target.style.opacity = String(initial)
  return {
    get opacity() {
      return opacity
    },
    async to(next, ms = FADE_MS) {
      if (next === opacity) return
      opacity = next
      target.style.transition = ms > 0 ? `opacity ${ms}ms ease-in-out` : 'none'
      target.style.opacity = String(next)
      if (ms > 0) await wait(ms)
    },
  }
}

/** True for URLs that must not fade: debug spawns, frozen poses and debug cameras (`make shots`, pose links). */
export const noFade = (search: string): boolean => {
  const q = new URLSearchParams(search)
  return ['x', 'y', 'z', 'yaw', 'freeze', 'cam'].some((k) => q.has(k))
}

/** The #fade overlay element, starting at `initial`. */
export function mountFade(initial: number): Fade {
  const el = document.createElement('div')
  el.id = 'fade'
  el.className = 'screen-fade'
  document.body.append(el)
  return createFade(el, initial)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
