// The settings panel, shared by the start screen and the in-race Esc menu. Writes through to localStorage.
import { CAMERA_EVENT, loadView, saveView, VIEWS, type ViewMode } from '../camera/views'
import { FX } from '../render/fx/flags'
import { MAX_LAPS } from '../race/lap'
import { LIVERY_EVENT, loadSettings, saveSettings, type Settings } from './settings'
import { clampLivery, MAX_NUMBER, PAINT_IDS, PATTERNS } from '../render/car/livery'
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
  // Livery: applies at once to the car (and its ghost) through LIVERY_EVENT.
  const repaint = () => {
    s.livery = clampLivery(s.livery)
    saveSettings(localStorage, s)
    window.dispatchEvent(new CustomEvent(LIVERY_EVENT, { detail: s.livery }))
  }
  const pattern = document.createElement('select')
  pattern.id = 'setting-livery'
  for (const p of PATTERNS) pattern.append(new Option(p, p, false, p === s.livery.pattern))
  pattern.addEventListener('change', () => {
    s.livery = { ...s.livery, pattern: pattern.value as Settings['livery']['pattern'] }
    repaint()
  })
  box.append(label('Livery'), pattern)
  const paint = document.createElement('select')
  paint.id = 'setting-paint'
  for (const p of PAINT_IDS) paint.append(new Option(p, p, false, p === s.livery.paint))
  paint.addEventListener('change', () => {
    s.livery = { ...s.livery, paint: paint.value as Settings['livery']['paint'] }
    repaint()
  })
  box.append(label('Colour'), paint)
  const num = Object.assign(document.createElement('input'), { type: 'number', min: '1', max: String(MAX_NUMBER), value: String(s.livery.number), id: 'setting-number' })
  num.addEventListener('change', () => {
    s.livery = { ...s.livery, number: Number(num.value) }
    repaint()
    num.value = String(s.livery.number)
  })
  box.append(label('Race number'), num)
  box.append(Object.assign(label('Effects, laps, time and weather apply on the next race'), { className: 'menu-hint' }))
  return box
}
