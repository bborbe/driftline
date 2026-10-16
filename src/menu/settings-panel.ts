// The settings panel, shared by the start screen and the in-race Esc menu. Writes through to localStorage.
import { FX } from '../render/fx/flags'
import { loadSettings, saveSettings, type Settings } from './settings'

export interface SettingsHooks {
  /** Live volume change, e.g. GameAudio.setVolume. */
  onVolume?: (v: number) => void
}

export function settingsPanel(hooks: SettingsHooks = {}): HTMLElement {
  const s: Settings = loadSettings(localStorage)
  const box = document.createElement('div')
  box.className = 'menu-settings'
  const label = (text: string) => Object.assign(document.createElement('span'), { textContent: text })

  const vol = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) })
  vol.addEventListener('input', () => {
    s.volume = Number(vol.value)
    saveSettings(localStorage, s)
    hooks.onVolume?.(s.volume)
  })
  box.append(label('Volume'), vol)

  for (const f of FX) {
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: s.fx.includes(f) })
    cb.addEventListener('change', () => {
      s.fx = FX.filter((x) => (x === f ? cb.checked : s.fx.includes(x)))
      saveSettings(localStorage, s)
    })
    box.append(label(`Effect: ${f}`), cb)
  }
  // Slots for the camera-view and lap-count tasks; wired when those land.
  box.append(label('Camera'), Object.assign(label('chase'), { className: 'menu-slot' }))
  box.append(label('Laps'), Object.assign(label('1'), { className: 'menu-slot' }))
  box.append(Object.assign(label('Effects apply on the next race'), { className: 'menu-hint' }))
  return box
}
