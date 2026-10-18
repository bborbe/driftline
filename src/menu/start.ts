// Start screen (operator's Lavish pick, 2026-10-18: option A): a translucent panel on the left with one tile per track —
// its top-down frame (scripts/thumbs.mjs → public/thumbs/, falling back to the SVG outline), a tier colour band and the
// best-medal dot — grouped Campaign, Styles and (with `?dev=1` only) Test; a preview panel beside it with the focused
// track's chase-camera frame, PB and every medal time against it; then Settings. Resolves with the chosen track name.
// Arrows + Enter/Space or the mouse: left/right within a group, up/down between groups. `focus` opens on that track's
// tile (a reload's `?sel=`), and `onFocus` hears every focus move (the track, or null on the Settings button) so the URL
// can follow it.
import './menu.css'
import { MEDAL_LABEL, type Medal } from '../race/medals'
import { formatLapTime, RaceStore } from '../race/store'
import { formatDelta } from '../race/medals'
import { menuGroups, type MenuEntry } from '../track/catalogue'
import { centreline } from '../track/centreline'
import { layoutId } from '../track/schema'
import { loadLap } from '../track/registry'
import { devMode } from '../debug/tuning'
import { isSelectKey, moveGrid, type GridPos } from './nav'
import { labelTrackDefault, settingsPanel } from './settings-panel'
import { trackEnvironment } from '../track/environment'
import { outlinePath } from './thumbnail'
import { medalRows, thumbUrl } from './preview'

/** Outline size for a tile with no rendered thumbnail (test tracks, or a track `make thumbs` has not shot yet). */
const OUTLINE = 120

export interface ChooseOptions {
  focus?: string | null
  onFocus?: (track: string | null) => void
  /** Query the menu reads `?dev=1` from (default: the page's). */
  search?: string
  /** Over the live 3D menu scene: transparent screen background, so the canvas shows through (src/menu/scene.ts). */
  live?: boolean
}

export function chooseTrack(names: string[], opts: ChooseOptions = {}): Promise<string> {
  return new Promise((resolve) => {
    const screen = document.createElement('div')
    screen.className = `menu-screen menu-select${opts.live ? ' menu-live' : ''}`
    screen.id = 'start-menu'
    const panel = el('div', 'menu-panel')
    const preview = el('aside', 'menu-preview')
    const title = el('h1', '', 'DRIFTLINE')
    const done = (name: string) => {
      window.removeEventListener('keydown', onKey, true)
      screen.remove()
      resolve(name)
    }
    let settingsOpen = false
    const settings = document.createElement('div')
    settings.hidden = true
    settings.append(settingsPanel())
    const toggleSettings = () => {
      settingsOpen = !settingsOpen
      settings.hidden = !settingsOpen
      if (settingsOpen) settings.scrollIntoView({ block: 'nearest' })
    }

    // One row per track group, then the settings button; actions[row][col] fires on select.
    const buttons: HTMLElement[][] = []
    const actions: (() => void)[][] = []
    const sections: HTMLElement[] = []
    for (const group of menuGroups(names, devMode(opts.search ?? location.search))) {
      const section = el('section', `menu-group menu-group-${group.id}`)
      const row = el('div', 'menu-tiles')
      buttons.push(group.entries.map((e) => row.appendChild(tile(e, group.id !== 'test'))))
      actions.push(group.entries.map((e) => () => done(e.track)))
      section.append(el('h2', '', group.title.toUpperCase()), row)
      sections.push(section)
    }
    const settingsButton = el('button', 'menu-card menu-settings-button', 'SETTINGS')
    buttons.push([settingsButton])
    actions.push([toggleSettings])

    const row0 = buttons.findIndex((row) => row.some((b) => b.dataset.track === opts.focus))
    let pos: GridPos = row0 < 0 ? { row: 0, col: 0 } : { row: row0, col: buttons[row0].findIndex((b) => b.dataset.track === opts.focus) }
    const focus = (p: GridPos) => {
      pos = p
      buttons.forEach((row, r) => row.forEach((b, c) => b.classList.toggle('menu-focus', r === p.row && c === p.col)))
      const name = buttons[p.row][p.col].dataset.track ?? null
      // The Settings button keeps the last tile's track default and preview.
      if (name) {
        labelTrackDefault(settings, trackEnvironment(loadLap(name)))
        showPreview(preview, name, buttons[p.row][p.col].dataset.rendered === '1', () => done(name))
      }
      opts.onFocus?.(name)
    }
    buttons.forEach((row, r) =>
      row.forEach((b, c) => {
        b.addEventListener('mouseenter', () => focus({ row: r, col: c }))
        b.addEventListener('click', (e) => {
          e.stopPropagation()
          actions[r][c]()
        })
      }),
    )
    focus(pos)

    const hint = el('p', 'menu-hint', '←/→ choose · ↑/↓ group · Enter start · Esc close settings')
    panel.append(title, ...sections, settingsButton, settings, hint)
    screen.append(panel, preview)
    document.body.append(screen)

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Escape' && settingsOpen) toggleSettings()
      else if (isSelectKey(e.code)) actions[pos.row][pos.col]()
      else {
        const next = moveGrid(pos, buttons.map((r) => r.length), e.code)
        if (next === pos) return
        focus(next)
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
  })
}

/** A track tile: thumbnail (rendered frame, or the SVG outline), tier band, label and best-medal dot. */
function tile(entry: MenuEntry, rendered: boolean): HTMLElement {
  const track = loadLap(entry.track)
  const store = new RaceStore(localStorage, track.name, layoutId(track))
  const b = el('button', 'menu-card menu-tile')
  b.dataset.track = entry.track
  b.dataset.rendered = rendered ? '1' : '0'
  const thumb = el('div', 'menu-thumb')
  const outline = () => thumb.replaceChildren(outlineSvg(entry.track), ...thumb.querySelectorAll('.tier-band'))
  if (rendered) {
    const img = Object.assign(document.createElement('img'), { src: thumbUrl(import.meta.env.BASE_URL, entry.track), alt: entry.track, loading: 'lazy' })
    img.addEventListener('error', () => {
      b.dataset.rendered = '0'
      outline()
    })
    thumb.append(img)
  } else thumb.append(outlineSvg(entry.track))
  thumb.append(el('i', `tier-band tier-${entry.tier ?? 'none'}`))
  const meta = el('div', 'menu-tile-meta')
  meta.append(el('span', 'menu-tile-label', entry.label), medalDot(store.bestMedal()))
  b.append(thumb, meta)
  return b
}

function outlineSvg(name: string): SVGElement {
  const svgNs = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', `0 0 ${OUTLINE} ${OUTLINE}`)
  const path = document.createElementNS(svgNs, 'path')
  path.setAttribute('d', outlinePath(centreline(loadLap(name), 4), OUTLINE))
  svg.append(path)
  return svg
}

const medalDot = (m: Medal | null): HTMLElement => {
  const dot = el('i', `medal-dot medal-${m ?? 'none'}`)
  dot.title = m ? `${MEDAL_LABEL[m]} MEDAL` : 'NO MEDAL'
  return dot
}

/** The preview panel for `name`: chase-camera frame, name and tier, PB with its medal, every medal time vs the PB, RACE. */
function showPreview(preview: HTMLElement, name: string, rendered: boolean, race: () => void): void {
  const track = loadLap(name)
  const store = new RaceStore(localStorage, track.name, layoutId(track))
  const pb = store.best()
  const shot = el('div', 'menu-preview-shot')
  if (rendered) {
    const img = Object.assign(document.createElement('img'), { src: thumbUrl(import.meta.env.BASE_URL, name, 'drive'), alt: '' })
    img.addEventListener('error', () => img.remove())
    shot.append(img)
  }
  const entry = menuGroups([name], true)[0]?.entries[0]
  const head = el('div', 'menu-preview-head')
  head.append(el('span', 'menu-preview-name', entry && entry.label !== name ? `${entry.label} · ${name}` : name))
  if (entry?.tier) head.append(el('span', `menu-tier menu-tier-${entry.tier}`, entry.tier))
  const pbLine = el('div', 'menu-preview-pb', pb === null ? 'PB — not raced' : `PB ${formatLapTime(pb)}`)
  pbLine.append(medalDot(store.bestMedal()))
  const table = el('table', 'menu-preview-medals')
  for (const r of medalRows(track.medals, pb)) {
    const tr = el('tr', '')
    const d = r.deltaMs
    const cell = el('td', '')
    cell.append(medalDot(r.medal), document.createTextNode(` ${MEDAL_LABEL[r.medal]}`))
    tr.append(cell, el('td', '', formatLapTime(r.ms)), el('td', d === null ? '' : Math.round(d) <= 0 ? 'race-ahead' : 'race-behind', d === null ? '' : formatDelta(d)))
    table.append(tr)
  }
  const go = el('button', 'menu-item menu-race-button', 'RACE ▸')
  go.addEventListener('click', (e) => {
    e.stopPropagation()
    race()
  })
  preview.replaceChildren(shot, head, pbLine, table, go)
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.textContent = text
  return e
}
