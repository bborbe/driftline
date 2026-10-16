// DOM overlay: lap HUD, countdown, finish panel with name entry, leaderboard.
import './race.css'
import { formatLapTime, type RaceStore } from './store'

export interface HudState {
  countdown: number | null
  time: string
  checkpoints: string
  best: number | null
}

export class RaceView {
  private readonly hud = el('div', 'race-hud')
  private readonly countdown = el('div', 'race-countdown')
  private readonly panel = el('div', 'race-panel')
  typing = false

  private readonly store: RaceStore

  constructor(store: RaceStore) {
    this.store = store
    document.body.append(this.hud, this.countdown, this.panel)
    this.panel.hidden = true
  }

  render(s: HudState): void {
    this.countdown.textContent = s.countdown === null ? '' : String(s.countdown)
    const best = s.best === null ? '--' : formatLapTime(s.best)
    this.hud.textContent = `${s.time}   CP ${s.checkpoints}   BEST ${best}   [R] respawn [⌫] restart [L] leaderboard`
  }

  showFinish(lapTimeMs: number, isNewBest: boolean): void {
    this.panel.hidden = false
    this.panel.replaceChildren(el('h2', '', `${isNewBest ? 'NEW BEST! ' : ''}${formatLapTime(lapTimeMs)}`))
    if (!this.store.qualifies(lapTimeMs)) {
      this.panel.append(this.board(), el('p', '', 'Backspace to race again'))
      return
    }
    const name = document.createElement('input')
    name.maxLength = 12
    name.value = this.store.lastName()
    name.placeholder = 'NAME'
    this.typing = true
    name.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key !== 'Enter') return
      this.store.addToLeaderboard(name.value, lapTimeMs)
      this.typing = false
      this.panel.replaceChildren(el('h2', '', formatLapTime(lapTimeMs)), this.board(lapTimeMs), el('p', '', 'Backspace to race again'))
    })
    this.panel.append(el('p', '', 'Top 10! Enter your name:'), name)
    name.focus()
  }

  hideFinish(): void {
    this.panel.hidden = true
    this.typing = false
  }

  toggleLeaderboard(): void {
    if (!this.panel.hidden) return this.hideFinish()
    this.panel.replaceChildren(this.board(), el('p', '', 'L to close'))
    this.panel.hidden = false
  }

  private board(highlight?: number): HTMLElement {
    const entries = this.store.leaderboard()
    const box = el('div', 'race-board')
    box.append(el('h3', '', 'TOP 10'))
    if (entries.length === 0) {
      box.append(el('p', '', 'No laps yet'))
      return box
    }
    const ol = document.createElement('ol')
    for (const e of entries) {
      const li = el('li', e.lapTimeMs === highlight ? 'race-mine' : '', `${e.name}  ${formatLapTime(e.lapTimeMs)}`)
      ol.append(li)
    }
    box.append(ol)
    return box
  }
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.textContent = text
  return e
}
