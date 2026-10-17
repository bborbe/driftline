// The settings panel, shared by the start screen and the in-race Esc menu. Writes through to localStorage and fires
// SETTINGS_EVENT after every change, so the running race applies it at once (src/menu/live.ts); nothing needs a reload.
// Controls sit in tabs (src/menu/tabs.ts): click a tab or press Q / E; the last open tab is remembered.
import { CAMERA_EVENT, loadView, saveView, VIEWS, type ViewMode } from '../camera/views'
import { CAMERA_FX, CAMERA_FX_EVENT, loadCameraFx, saveCameraFx, type CameraFx } from '../camera/feel'
import { LIVE_FX } from '../render/fx/flags'
import { MAX_LAPS } from '../race/lap'
import { loadSettings, saveSettings, SETTINGS_EVENT, type Settings } from './settings'
import { clampLivery, MAX_NUMBER, PAINT_IDS, PATTERNS } from '../render/car/livery'
import { TIME_CHOICES, WEATHER_CHOICES, type Environment, type TimeChoice, type WeatherChoice } from '../track/environment'
import { loadTab, moveTab, saveTab, TAB_CONTROLS, TAB_LABELS, TABS, type ControlId, type Tab } from './tabs'

export interface SettingsHooks {
  /** Live volume change, e.g. GameAudio.setVolume. */
  onVolume?: (v: number) => void
  /** The current track's own time and weather, named on the "Track default" options (labelTrackDefault updates it). */
  trackDefault?: Environment
}

const VIEW_LABELS: Record<ViewMode, string> = { close: 'Close chase', far: 'Far chase', cockpit: 'In-car' }
const CAMERA_FX_LABELS: Record<CameraFx, string> = { off: 'Off', low: 'Low', full: 'Full' }
/** Option label; "Track default" names what it resolves to on the track when that is known: `Track default (snow)`. */
export const choiceLabel = (c: string, trackDefault?: string): string =>
  c === 'default' ? `Track default${trackDefault ? ` (${trackDefault})` : ''}` : c[0].toUpperCase() + c.slice(1)

/** Rename the "Track default" Time and Weather options under `root` for the track whose environment is `env`. */
export function labelTrackDefault(root: ParentNode, env: Environment): void {
  for (const [id, value] of [['setting-time', env.time], ['setting-weather', env.weather]] as const) {
    const opt = root.querySelector<HTMLOptionElement>(`#${id} option[value="default"]`)
    if (opt) opt.textContent = choiceLabel('default', value)
  }
}

export function settingsPanel(hooks: SettingsHooks = {}): HTMLElement {
  const s: Settings = loadSettings(localStorage)
  const controls = {} as Record<ControlId, HTMLElement[]>
  const add = (id: ControlId, ...els: HTMLElement[]) => void (controls[id] = els)
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
  add('volume', label('Volume'), vol)
  // The SFX and UI buses under the master: the running race applies them through SETTINGS_EVENT (main.ts).
  for (const [id, text] of [['sfxVolume', 'Effects (SFX)'], ['uiVolume', 'Menu (UI)']] as const) {
    const bus = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: String(s[id]), id: `setting-${id}` })
    bus.addEventListener('input', () => {
      s[id] = Number(bus.value)
      commit()
    })
    add(id, label(text), bus)
  }

  // Only the effects a toggle changes: bloom and skid marks are always on (glow.ts, view.ts).
  for (const f of LIVE_FX) {
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: s.fx.includes(f), id: `setting-fx-${f}` })
    cb.addEventListener('change', () => {
      s.fx = LIVE_FX.filter((x) => (x === f ? cb.checked : s.fx.includes(x)))
      commit()
    })
    add(f, label(`Effect: ${f}`), cb)
  }
  const cam = document.createElement('select')
  for (const v of VIEWS) cam.append(Object.assign(document.createElement('option'), { value: v, textContent: VIEW_LABELS[v] }))
  cam.value = loadView(localStorage)
  cam.addEventListener('change', () => {
    saveView(localStorage, cam.value as ViewMode)
    window.dispatchEvent(new CustomEvent(CAMERA_EVENT, { detail: cam.value }))
  })
  // Camera effects (accessibility): Off is the plain chase camera — no speed FOV, lean, shake, start sweep or finish orbit.
  const camFx = document.createElement('select')
  camFx.id = 'setting-camera-fx'
  for (const v of CAMERA_FX) camFx.append(new Option(CAMERA_FX_LABELS[v], v, false, v === loadCameraFx(localStorage)))
  camFx.addEventListener('change', () => {
    saveCameraFx(localStorage, camFx.value as CameraFx)
    window.dispatchEvent(new CustomEvent(CAMERA_FX_EVENT, { detail: camFx.value }))
  })
  add('camera', label('Camera (1/2/3)'), cam, label('Camera effects'), camFx)
  const laps = document.createElement('select')
  laps.id = 'setting-laps'
  for (let n = 1; n <= MAX_LAPS; n++) laps.append(new Option(String(n), String(n), false, n === s.laps))
  laps.addEventListener('change', () => {
    s.laps = Number(laps.value)
    commit()
  })
  add('laps', label('Laps (from the next restart)'), laps)
  const time = document.createElement('select')
  time.id = 'setting-time'
  for (const c of TIME_CHOICES) time.append(new Option(choiceLabel(c, hooks.trackDefault?.time), c, false, c === s.time))
  time.addEventListener('change', () => {
    s.time = time.value as TimeChoice
    commit()
  })
  add('time', label('Time of day'), time)
  const weather = document.createElement('select')
  weather.id = 'setting-weather'
  for (const c of WEATHER_CHOICES) weather.append(new Option(choiceLabel(c, hooks.trackDefault?.weather), c, false, c === s.weather))
  weather.addEventListener('change', () => {
    s.weather = weather.value as WeatherChoice
    commit()
  })
  add('weather', label('Weather'), weather)
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
  add('livery', label('Livery'), pattern)
  const paint = document.createElement('select')
  paint.id = 'setting-paint'
  for (const p of PAINT_IDS) paint.append(new Option(p, p, false, p === s.livery.paint))
  paint.addEventListener('change', () => {
    s.livery = { ...s.livery, paint: paint.value as Settings['livery']['paint'] }
    repaint()
  })
  add('paint', label('Colour'), paint)
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
  add('number', label('Race number'), num)
  return tabbed(controls)
}

/** The tab strip over one page per tab; Q / E switch while the panel is on screen. */
function tabbed(controls: Record<ControlId, HTMLElement[]>): HTMLElement {
  const box = document.createElement('div')
  box.className = 'menu-settings-tabs'
  const strip = Object.assign(document.createElement('div'), { className: 'menu-tabs' })
  const buttons = {} as Record<Tab, HTMLButtonElement>
  const pages = {} as Record<Tab, HTMLElement>
  let current = loadTab(localStorage)
  const show = (tab: Tab) => {
    current = tab
    saveTab(localStorage, tab)
    for (const t of TABS) {
      buttons[t].classList.toggle('menu-tab-active', t === tab)
      buttons[t].setAttribute('aria-selected', String(t === tab))
      pages[t].hidden = t !== tab
    }
  }
  for (const t of TABS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'menu-tab', textContent: TAB_LABELS[t], id: `setting-tab-${t}` })
    b.setAttribute('role', 'tab')
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      show(t)
    })
    buttons[t] = b
    const page = Object.assign(document.createElement('div'), { className: 'menu-settings', id: `setting-page-${t}` })
    page.setAttribute('role', 'tabpanel')
    page.append(...TAB_CONTROLS[t].flatMap((id) => controls[id]))
    pages[t] = page
  }
  strip.append(...TABS.map((t) => buttons[t]), Object.assign(document.createElement('span'), { className: 'menu-hint', textContent: 'Q / E' }))
  box.append(strip, ...TABS.map((t) => pages[t]))
  show(current)
  // One listener per panel; a panel the Esc menu replaced drops its own on the next key.
  const onKey = (e: KeyboardEvent) => {
    if (!box.isConnected) return window.removeEventListener('keydown', onKey, true)
    if (box.getClientRects().length === 0 || (e.target as HTMLElement | null)?.tagName === 'INPUT') return
    const next = moveTab(current, e.code)
    if (next === current) return
    show(next)
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey, true)
  return box
}
