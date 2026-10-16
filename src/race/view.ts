// DOM overlay: lap HUD, countdown, finish panel with name entry, leaderboard.
import './race.css'
import { formatDelta, MEDAL_LABEL, type Medal } from './medals'
import { formatLapTime, type RaceStore } from './store'

/** How long a split delta stays on screen. */
const SPLIT_MS = 2500

export interface MedalResult {
  earned: Medal | null
  next: Medal | null
  nextMs: number | null
  best: Medal | null
}

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
  private readonly pause = el('div', 'race-pause')
  private readonly split = el('div', 'race-split')
  private splitTimer: ReturnType<typeof setTimeout> | undefined
  typing = false

  private readonly store: RaceStore

  constructor(store: RaceStore) {
    this.store = store
    document.body.append(this.hud, this.countdown, this.panel, this.pause, this.split)
    this.split.hidden = true
    this.panel.hidden = true
    this.pause.hidden = true
    this.pause.append(el('h2', '', 'PAUSED — Esc to resume'), el('p', '', '[R] respawn  [⌫] restart  [L] leaderboard'))
  }

  render(s: HudState): void {
    this.countdown.textContent = s.countdown === null ? '' : String(s.countdown)
    const best = s.best === null ? '--' : formatLapTime(s.best)
    this.hud.textContent = `${s.time}   CP ${s.checkpoints}   BEST ${best}   [R] respawn [⌫] restart [L] leaderboard`
  }

  /** Flash a split delta (blue ahead, red behind); null hides it. */
  showSplit(deltaMs: number | null): void {
    clearTimeout(this.splitTimer)
    this.split.hidden = deltaMs === null
    if (deltaMs === null) return
    this.split.textContent = formatDelta(deltaMs)
    this.split.className = `race-split ${Math.round(deltaMs) < 0 ? 'race-ahead' : 'race-behind'}`
    this.splitTimer = setTimeout(() => (this.split.hidden = true), SPLIT_MS)
  }

  showPause(paused: boolean): void {
    this.pause.hidden = !paused
  }

  showFinish(lapTimeMs: number, isNewBest: boolean, medals?: MedalResult): void {
    this.panel.hidden = false
    this.panel.replaceChildren(el('h2', '', `${isNewBest ? 'NEW BEST! ' : ''}${formatLapTime(lapTimeMs)}`))
    if (medals) this.panel.append(medalLine(medals))
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

function medalLine(m: MedalResult): HTMLElement {
  const box = el('div', 'race-medals')
  box.append(el('p', `race-medal race-medal-${m.earned ?? 'none'}`, m.earned ? `${MEDAL_LABEL[m.earned]} MEDAL` : 'NO MEDAL'))
  if (m.next && m.nextMs !== null) box.append(el('p', '', `Next: ${MEDAL_LABEL[m.next]} ${formatLapTime(m.nextMs)}`))
  if (m.best) box.append(el('p', '', `Best medal: ${MEDAL_LABEL[m.best]}`))
  return box
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.textContent = text
  return e
}
