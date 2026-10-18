// Gamepad shell: polls navigator.getGamepads() once per animation frame, presses the keys the pad's buttons stand for
// (src/gamepad.ts tables) as synthetic key events on window, and shows a "Controller connected" toast on connect and
// disconnect. Driving reads the pad fresh each frame through `input()`, mixed with the keyboard by InputMix.
import { loadView, VIEWS, type ViewMode } from './camera/views'
import { CYCLE_CAMERA, padInput, PadKeys, pickPad, type PadAction, type PadContext } from './gamepad'
import type { CarInput } from './physics'

export interface GamepadShell {
  /** The pad's driving input this frame, or null with no pad connected. */
  input(): CarInput | null
  /** Where button presses go from now on: menu keys or race keys. */
  setContext(context: () => PadContext): void
}

/** Key code that selects the view after `mode` (1 → 2 → 3 → 1). */
export const nextViewKey = (mode: ViewMode): string => `Digit${((VIEWS.indexOf(mode) + 1) % VIEWS.length) + 1}`

const TOAST_MS = 2500

export function mountGamepad(nav: Navigator = navigator): GamepadShell {
  const read = () => (typeof nav.getGamepads === 'function' ? pickPad([...nav.getGamepads()]) : null)
  let context: () => PadContext = () => 'menu'
  const keys = new PadKeys()
  const toast = document.createElement('div')
  toast.id = 'pad-toast'
  toast.hidden = true
  document.body.append(toast)
  let hideAt = 0
  let connected: string | null = null

  const press = (action: PadAction) => {
    const code = action === CYCLE_CAMERA ? nextViewKey(loadView(localStorage)) : action
    const key = code === 'Escape' || code === 'Enter' || code === 'Backspace' || code.startsWith('Arrow') ? code : code.replace(/^(Key|Digit)/, '').toLowerCase()
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }))
  }

  const poll = (now: number) => {
    const pad = read()
    const id = pad?.id ?? null
    if (id !== connected) {
      toast.textContent = id ? 'Controller connected' : 'Controller disconnected'
      toast.hidden = false
      hideAt = now + TOAST_MS
      connected = id
    }
    if (!toast.hidden && now >= hideAt) toast.hidden = true
    for (const action of keys.update(pad, context(), now)) press(action)
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)

  return {
    input() {
      const pad = read()
      return pad ? padInput(pad) : null
    },
    setContext(c) {
      context = c
    },
  }
}
