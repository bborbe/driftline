// Debug overlay for main.ts: pose readout and build label in the corners, dev only (?dev=1 / ?debug=1), backtick toggles them,
// and P copies the current pose as a debug-spawn URL with a short toast. The race HUD lives in src/race/view.ts.
import { mountBuildLabel } from '../build-info'
import { debugVisible } from '../race/hud'
import { isDebugKey } from '../race/controls'

export interface DebugOverlay {
  /** The pose readout line. */
  setText(text: string): void
  onKeyDown(e: KeyboardEvent): void
}

export interface DebugOptions {
  search: string
  /** The debug-spawn query for the current view (fly camera or car), and the toast to show once it is copied. */
  spawnLink: () => { query: string; copied: string }
}

/** True when a keydown should toggle the overlay: backtick, no repeat, no modifier, not typed into a field. */
export const debugToggle = (code: string, repeat: boolean, modified: boolean, inField: boolean): boolean =>
  isDebugKey(code) && !repeat && !modified && !inField

export function mountDebugOverlay(o: DebugOptions): DebugOverlay {
  const hud = document.createElement('div')
  hud.id = 'hud'
  document.body.appendChild(hud)
  mountBuildLabel()
  document.documentElement.classList.toggle('debug-off', !debugVisible(o.search))

  // P copies the current pose as a debug-spawn URL, so a visual bug can be reproduced at the exact spot.
  // The toast is added on first use, after the race HUD, so it paints above it.
  let toast: HTMLDivElement | null = null
  let toastTimer = 0
  const show = (msg: string) => {
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'toast'
      document.body.appendChild(toast)
    }
    toast.textContent = msg
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast?.classList.remove('show'), 1500)
  }
  const copySpawn = () => {
    const { query, copied } = o.spawnLink()
    const url = `${location.origin}${location.pathname}${query}`
    navigator.clipboard.writeText(url).then(
      () => show(copied),
      () => show(url),
    )
  }

  return {
    setText(text) {
      hud.textContent = text
    },
    onKeyDown(e) {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      if (debugToggle(e.code, e.repeat, e.ctrlKey || e.metaKey || e.altKey, inField)) {
        document.documentElement.classList.toggle('debug-off')
      } else if (e.code === 'KeyP' && !e.repeat) copySpawn()
    },
  }
}
