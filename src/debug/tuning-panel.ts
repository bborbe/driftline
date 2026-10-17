// Dev tuning panel (?dev=1, F2): a slider per handling constant, grouped, each with its default and a reset
// per group and for all. A change goes live on the next physics tick (setHandling) and is stored in
// localStorage; Copy JSON / Apply JSON move a whole tune in and out. While the config differs from the
// defaults a TUNED badge shows and the run sets no records or ghosts (RunTaint in ./tuning).
import './tuning.css'
import { DEFAULT_HANDLING, handling, handlingFromJson, handlingToJson, isTuned, setHandling, type Handling } from '../physics/handling'
import { loadTuning, resetGroup, saveTuning, TUNING_GROUPS, type KeyValueStore } from './tuning'

export interface TuningPanel {
  /** F2 toggles the panel. */
  onKeyDown(e: KeyboardEvent): void
  readonly open: boolean
}

const fmt = (v: number, step: number): string => {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)))
  return v.toFixed(decimals)
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

/** Loads the stored tune into the live config and mounts the (closed) panel and the TUNED badge. */
export function mountTuningPanel(storage: KeyValueStore): TuningPanel {
  const stored = loadTuning(storage)
  if (stored) setHandling(stored)

  const badge = el('div', 'tuned-badge', 'TUNED')
  const panel = el('div', 'tuning-panel')
  panel.hidden = true
  document.body.append(badge, panel)
  // Keys typed into the panel (arrows on a slider, digits in the JSON box) never reach the car or the race.
  panel.addEventListener('keydown', (e) => {
    if (e.code !== 'F2') e.stopPropagation()
  })

  const rows = new Map<keyof Handling, { input: HTMLInputElement; value: HTMLSpanElement; row: HTMLElement }>()
  const apply = (h: Handling) => {
    setHandling(h)
    saveTuning(storage, h)
    refresh()
  }
  const refresh = () => {
    const h = handling()
    for (const g of TUNING_GROUPS) {
      for (const sl of g.sliders) {
        const r = rows.get(sl.key)
        if (!r) continue
        r.input.value = String(h[sl.key])
        r.value.textContent = fmt(h[sl.key], sl.step)
        r.row.classList.toggle('changed', h[sl.key] !== DEFAULT_HANDLING[sl.key])
      }
    }
    badge.hidden = !isTuned(h)
  }

  const head = el('div', 'tuning-head')
  head.append(el('strong', '', 'Handling (F2)'))
  const resetAll = el('button', '', 'Reset all')
  resetAll.addEventListener('click', () => apply({ ...DEFAULT_HANDLING }))
  const copy = el('button', '', 'Copy JSON')
  const json = el('textarea', 'tuning-json')
  json.rows = 4
  json.placeholder = 'Paste a tune JSON here, then Apply JSON'
  copy.addEventListener('click', () => {
    const text = handlingToJson()
    json.value = text
    void navigator.clipboard?.writeText(text).catch(() => undefined)
  })
  const paste = el('button', '', 'Apply JSON')
  const status = el('span', 'tuning-status')
  paste.addEventListener('click', () => {
    const h = handlingFromJson(json.value)
    status.textContent = h ? 'applied' : 'not a JSON object'
    if (h) apply(h)
  })
  head.append(resetAll, copy, paste, status)
  panel.append(head, json)

  for (const g of TUNING_GROUPS) {
    const section = el('details', 'tuning-group')
    section.open = true
    const summary = el('summary', '', g.title)
    const reset = el('button', '', 'Reset')
    reset.addEventListener('click', (e) => {
      e.preventDefault()
      apply(resetGroup(handling(), g))
    })
    summary.append(reset)
    section.append(summary)
    for (const sl of g.sliders) {
      const row = el('label', 'tuning-row')
      row.dataset.key = sl.key
      const input = Object.assign(el('input'), { type: 'range', min: String(sl.min), max: String(sl.max), step: String(sl.step) })
      input.addEventListener('input', () => apply({ ...handling(), [sl.key]: Number(input.value) }))
      // Hand the keyboard back to the car once the slider is released.
      input.addEventListener('change', () => input.blur())
      const value = el('span', 'tuning-value')
      row.append(el('span', 'tuning-label', sl.label), input, value, el('span', 'tuning-default', `def ${fmt(DEFAULT_HANDLING[sl.key], sl.step)}`))
      rows.set(sl.key, { input, value, row })
      section.append(row)
    }
    panel.append(section)
  }
  refresh()

  return {
    onKeyDown(e) {
      if (e.code !== 'F2' || e.repeat) return
      e.preventDefault()
      panel.hidden = !panel.hidden
    },
    get open() {
      return !panel.hidden
    },
  }
}
