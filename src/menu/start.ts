// Start screen: a Campaign row and a Test row of track cards (outline, personal best, best medal),
// then settings. Resolves with the chosen track name. Arrows + Enter/Space or the mouse:
// left/right within a row, up/down between rows.
import './menu.css'
import { MEDAL_LABEL } from '../race/medals'
import { formatLapTime, RaceStore } from '../race/store'
import { trackGroups, type MenuEntry } from '../track/catalogue'
import { centreline } from '../track/centreline'
import { layoutId } from '../track/schema'
import { loadLap } from '../track/registry'
import { isSelectKey, moveGrid, type GridPos } from './nav'
import { settingsPanel } from './settings-panel'
import { outlinePath } from './thumbnail'

const THUMB = 176
const TEST_THUMB = 96

export function chooseTrack(names: string[]): Promise<string> {
  return new Promise((resolve) => {
    const screen = document.createElement('div')
    screen.className = 'menu-screen'
    screen.id = 'start-menu'
    const title = Object.assign(document.createElement('h1'), { textContent: 'DRIFTLINE' })
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
    for (const group of trackGroups(names)) {
      const section = document.createElement('section')
      section.className = `menu-group menu-group-${group.id}`
      const row = Object.assign(document.createElement('div'), { className: 'menu-cards' })
      const thumb = group.id === 'test' ? TEST_THUMB : THUMB
      buttons.push(group.entries.map((e) => row.appendChild(card(e, thumb))))
      actions.push(group.entries.map((e) => () => done(e.track)))
      section.append(Object.assign(document.createElement('h2'), { textContent: group.title.toUpperCase() }), row)
      sections.push(section)
    }
    const settingsButton = Object.assign(document.createElement('button'), { className: 'menu-card', textContent: 'SETTINGS' })
    buttons.push([settingsButton])
    actions.push([toggleSettings])

    let pos: GridPos = { row: 0, col: 0 }
    const focus = (p: GridPos) => {
      pos = p
      buttons.forEach((row, r) => row.forEach((b, c) => b.classList.toggle('menu-focus', r === p.row && c === p.col)))
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

    const hint = Object.assign(document.createElement('p'), { className: 'menu-hint', textContent: '←/→ choose · ↑/↓ campaign / styles / test · Enter start · Esc close settings' })
    screen.append(title, ...sections, settingsButton, settings, hint)
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

function card(entry: MenuEntry, thumb: number): HTMLElement {
  const track = loadLap(entry.track)
  const store = new RaceStore(localStorage, track.name, layoutId(track))
  const b = document.createElement('button')
  b.className = thumb === THUMB ? 'menu-card' : 'menu-card menu-card-small'
  b.dataset.track = entry.track
  const svgNs = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('width', String(thumb))
  svg.setAttribute('height', String(thumb))
  const path = document.createElementNS(svgNs, 'path')
  path.setAttribute('d', outlinePath(centreline(track, 4), thumb))
  svg.append(path)
  const best = store.best()
  const medal = store.bestMedal()
  const line = (t: string) => Object.assign(document.createElement('p'), { textContent: t })
  b.append(svg, Object.assign(document.createElement('h3'), { textContent: entry.label }))
  if (entry.tier) b.append(Object.assign(document.createElement('p'), { className: `menu-tier menu-tier-${entry.tier}`, textContent: `${entry.tier} · ${entry.track}` }))
  b.append(line(`PB ${best === null ? '--' : formatLapTime(best)}`), line(medal ? `${MEDAL_LABEL[medal]} MEDAL` : 'NO MEDAL'))
  return b
}
