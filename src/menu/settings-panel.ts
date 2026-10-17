// The settings panel, shared by the start screen and the in-race Esc menu. Writes through to localStorage.
import { CAMERA_EVENT, loadView, saveView, VIEWS, type ViewMode } from '../camera/views'
import { FX } from '../render/fx/flags'
import { MAX_LAPS } from '../race/lap'
import { loadSettings, saveSettings, type Settings } from './settings'
import type { EnvironmentMode } from '../track/environment'

export interface SettingsHooks {
  /** Live volume change, e.g. GameAudio.setVolume. */
  onVolume?: (v: number) => void
}

const VIEW_LABELS: Record<ViewMode, string> = { close: 'Close chase', far: 'Far chase', cockpit: 'In-car' }
const ENVIRONMENT_LABELS: Record<EnvironmentMode, string> = { fixed: 'Track default', random: 'Random' }

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
  const cam = document.createElement('select')
  for (const v of VIEWS) cam.append(Object.assign(document.createElement('option'), { value: v, textContent: VIEW_LABELS[v] }))
  cam.value = loadView(localStorage)
  cam.addEventListener('change', () => {
    saveView(localStorage, cam.value as ViewMode)
    window.dispatchEvent(new CustomEvent(CAMERA_EVENT, { detail: cam.value }))
  })
  box.append(label('Camera (1/2/3)'), cam)
  const laps = document.createElement('select')
  for (let n = 1; n <= MAX_LAPS; n++) laps.append(new Option(String(n), String(n), false, n === s.laps))
  laps.addEventListener('change', () => {
    s.laps = Number(laps.value)
    saveSettings(localStorage, s)
  })
  box.append(label('Laps'), laps)
  const env = document.createElement('select')
  env.id = 'setting-environment'
  for (const [mode, text] of Object.entries(ENVIRONMENT_LABELS)) env.append(new Option(text, mode, false, mode === s.environment))
  env.addEventListener('change', () => {
    s.environment = env.value as EnvironmentMode
    saveSettings(localStorage, s)
  })
  box.append(label('Time and weather'), env)
  box.append(Object.assign(label('Effects, laps, time and weather apply on the next race'), { className: 'menu-hint' }))
  return box
}
