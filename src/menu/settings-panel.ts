// The settings panel, shared by the start screen and the in-race Esc menu. Writes through to localStorage and fires
// SETTINGS_EVENT after every change, so the running race applies it at once (src/menu/live.ts); nothing needs a reload.
import { CAMERA_EVENT, loadView, saveView, VIEWS, type ViewMode } from '../camera/views'
import { LIVE_FX } from '../render/fx/flags'
import { MAX_LAPS } from '../race/lap'
import { loadSettings, saveSettings, SETTINGS_EVENT, type Settings } from './settings'
import { clampLivery, MAX_NUMBER, PAINT_IDS, PATTERNS } from '../render/car/livery'
import { TIME_CHOICES, WEATHER_CHOICES, type TimeChoice, type WeatherChoice } from '../track/environment'

export interface SettingsHooks {
  /** Live volume change, e.g. GameAudio.setVolume. */
  onVolume?: (v: number) => void
}

const VIEW_LABELS: Record<ViewMode, string> = { close: 'Close chase', far: 'Far chase', cockpit: 'In-car' }
const choiceLabel = (c: string): string => (c === 'default' ? 'Track default' : c[0].toUpperCase() + c.slice(1))

export function settingsPanel(hooks: SettingsHooks = {}): HTMLElement {
  const s: Settings = loadSettings(localStorage)
  const box = document.createElement('div')
  box.className = 'menu-settings'
  const label = (text: string) => Object.assign(document.createElement('span'), { textContent: text })
  const commit = () => {
    saveSettings(localStorage, s)
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { ...s } }))
  }

  const vol = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) })
  vol.addEventListener('input', () => {
    s.volume = Number(vol.value)
    commit()
    hooks.onVolume?.(s.volume)
  })
  box.append(label('Volume'), vol)

  // Only the effects a toggle changes: bloom and skid marks are always on (glow.ts, view.ts).
  for (const f of LIVE_FX) {
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: s.fx.includes(f), id: `setting-fx-${f}` })
    cb.addEventListener('change', () => {
      s.fx = LIVE_FX.filter((x) => (x === f ? cb.checked : s.fx.includes(x)))
      commit()
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
  laps.id = 'setting-laps'
  for (let n = 1; n <= MAX_LAPS; n++) laps.append(new Option(String(n), String(n), false, n === s.laps))
  laps.addEventListener('change', () => {
    s.laps = Number(laps.value)
    commit()
  })
  box.append(label('Laps (from the next restart)'), laps)
  const time = document.createElement('select')
  time.id = 'setting-time'
  for (const c of TIME_CHOICES) time.append(new Option(choiceLabel(c), c, false, c === s.time))
  time.addEventListener('change', () => {
    s.time = time.value as TimeChoice
    commit()
  })
  box.append(label('Time of day'), time)
  const weather = document.createElement('select')
  weather.id = 'setting-weather'
  for (const c of WEATHER_CHOICES) weather.append(new Option(choiceLabel(c), c, false, c === s.weather))
  weather.addEventListener('change', () => {
    s.weather = weather.value as WeatherChoice
    commit()
  })
  box.append(label('Weather'), weather)
  // Livery: repaints the car (and its ghost) at once.
  const repaint = () => {
    s.livery = clampLivery(s.livery)
    commit()
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
  // While typing, repaint every valid number; on commit (blur / Enter) snap the field to the clamped value.
  num.addEventListener('input', () => {
    if (num.value === '' || !Number.isFinite(Number(num.value))) return
    s.livery = { ...s.livery, number: Number(num.value) }
    repaint()
  })
  num.addEventListener('change', () => {
    s.livery = { ...s.livery, number: Number(num.value) }
    repaint()
    num.value = String(s.livery.number)
  })
  box.append(label('Race number'), num)
  return box
}
