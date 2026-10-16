// Start screen: one card per shipped track (outline, personal best, best medal), then settings.
// Resolves with the chosen track name. Arrows + Enter/Space or the mouse.
import './menu.css'
import { MEDAL_LABEL } from '../race/medals'
import { formatLapTime, RaceStore } from '../race/store'
import { centreline } from '../track/centreline'
import { layoutId } from '../track/schema'
import { loadLap } from '../render/track/lap'
import { menuList } from './list'
import { settingsPanel } from './settings-panel'
import { outlinePath } from './thumbnail'

const THUMB = 176

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

    const cards = menuList(
      [...names.map((n) => ({ label: n, action: () => done(n) })), { label: 'Settings', action: () => toggleSettings() }],
      'menu-cards',
      'menu-card',
      (i) => (i < names.length ? card(names[i]) : Object.assign(document.createElement('button'), { textContent: 'SETTINGS' })),
    )
    const toggleSettings = () => {
      settingsOpen = !settingsOpen
      settings.hidden = !settingsOpen
    }
    const hint = Object.assign(document.createElement('p'), { className: 'menu-hint', textContent: '←/→ choose · Enter start · Esc close settings' })
    screen.append(title, cards.element, settings, hint)
    document.body.append(screen)

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Escape' && settingsOpen) toggleSettings()
      else if (!cards.key(e.code)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
  })
}

function card(name: string): HTMLElement {
  const track = loadLap(name)
  const store = new RaceStore(localStorage, track.name, layoutId(track))
  const b = document.createElement('button')
  const svgNs = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('width', String(THUMB))
  svg.setAttribute('height', String(THUMB))
  const path = document.createElementNS(svgNs, 'path')
  path.setAttribute('d', outlinePath(centreline(track, 4), THUMB))
  svg.append(path)
  const best = store.best()
  const medal = store.bestMedal()
  const line = (t: string) => Object.assign(document.createElement('p'), { textContent: t })
  b.append(svg, Object.assign(document.createElement('h3'), { textContent: name }), line(`PB ${best === null ? '--' : formatLapTime(best)}`), line(medal ? `${MEDAL_LABEL[medal]} MEDAL` : 'NO MEDAL'))
  return b
}
