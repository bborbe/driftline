// Menu sounds: one capture listener on the document turns real clicks and option changes into UI-bus one-shots,
// so every menu (start screen, Esc menu, settings tabs, finish panel) sounds the same with no per-button wiring.
import type { UiSound } from './mapping'

type Target = { tagName?: string; type?: string; classList?: { contains(c: string): boolean }; closest?(sel: string): unknown } | null

/** The UI sound a click on `el` makes: tabs and toggles click, buttons confirm; anything else is silent. */
export const clickSound = (el: Target): UiSound | null => {
  const tag = el?.tagName?.toUpperCase()
  if (!tag) return null
  if (el?.classList?.contains('menu-tab')) return 'click'
  if (tag === 'BUTTON') return 'confirm'
  if (tag === 'INPUT' && el?.type === 'checkbox') return 'click'
  return null
}

/** The UI sound an option change on `el` makes: selects and sliders click (checkboxes already did on click). */
export const changeSound = (el: Target): UiSound | null => {
  const tag = el?.tagName?.toUpperCase()
  if (tag === 'SELECT') return 'click'
  if (tag === 'INPUT' && el?.type === 'range') return 'click'
  return null
}

// A slider drag fires `input` every step; tick at most this often (ms).
const SLIDER_GAP = 90

export const mountUiSounds = (play: (sound: UiSound, detail?: string) => void, root: Document = document): void => {
  let lastSlider = 0
  const name = (el: Element) => el.id || el.className || el.tagName.toLowerCase()
  root.addEventListener(
    'click',
    (e) => {
      // Synthetic clicks (the menu pick re-clicking Begin) are the game's own, not the player's.
      if (!e.isTrusted) return
      const el = (e.target as Element | null)?.closest?.('button, input') ?? null
      const sound = clickSound(el as Target)
      if (el && sound) play(sound, name(el))
    },
    true,
  )
  const onChange = (e: Event) => {
    if (!e.isTrusted) return
    const el = e.target as Element | null
    const sound = changeSound(el as Target)
    if (!el || !sound) return
    if ((el as HTMLInputElement).type === 'range') {
      const now = performance.now()
      if (now - lastSlider < SLIDER_GAP) return
      lastSlider = now
    } else if (e.type === 'input') return
    play(sound, name(el))
  }
  root.addEventListener('input', onChange, true)
  root.addEventListener('change', onChange, true)
}
