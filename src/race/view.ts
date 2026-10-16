// DOM overlay: race HUD (timer bottom centre, speedometer bottom right, medal target top left, lap / checkpoint
// top right, split pop-up), start lights + 3-2-1-GO! countdown, finish panel with name entry, leaderboard, Esc menu. Key hints sit bottom left with the debug overlay.
import './race.css'
import { menuList, type MenuList } from '../menu/list'
import { litTicks, SPEEDO_TICKS, type Target } from './hud'
import { formatDelta, MEDAL_LABEL, type Medal } from './medals'
import { formatLapTime, type RaceStore } from './store'

/** How long a split delta stays on screen. */
const SPLIT_MS = 2500
/** How long GO! stays up after the countdown. */
const GO_MS = 900

export interface MedalResult {
  earned: Medal | null
  next: Medal | null
  nextMs: number | null
  best: Medal | null
}

/** In-race menu actions (Esc menu and finish panel). */
export interface MenuActions {
  resume(): void
  restart(): void
  backToMenu(): void
  nextTrack(): void
  /** A fresh settings panel (the same one the start screen shows). */
  settings(): HTMLElement
}

export interface HudState {
  time: string
  checkpoints: string
  /** Current lap of total, e.g. `2/3` (`1/1` in a single-lap run). */
  lap: string
  /** Fastest lap finished this run (ms), null before the first. */
  runBest: number | null
  /** All-time best for this track and lap count. */
  best: number | null
  /** Forward speed, whole km/h (0 after the finish). */
  speedKmh: number
  /** Next medal to chase, or the personal best once there is none left. */
  target: Target | null
}

/** A split pop-up: the run time at the checkpoint and its delta vs the personal best (null without one). */
export interface Split {
  timeMs: number
  deltaMs: number | null
}

export class RaceView {
  private readonly keys = el('div', 'race-keys', 'R respawn · ⌫ restart · L leaderboard · F fullscreen · 1/2/3 camera · C fly · H debug')
  private readonly status = el('div', 'race-status')
  private readonly lap = el('div', 'race-lap')
  private readonly cp = el('div', 'race-cp')
  private readonly chase = el('div', 'race-chase')
  private readonly target = el('div', 'race-target')
  private readonly best = el('div', 'race-best')
  private readonly lights = el('div', 'race-lights')
  private readonly count = el('div', 'race-count')
  private countTimer: ReturnType<typeof setTimeout> | undefined
  private readonly speedo = el('div', 'race-speedo')
  private readonly ticks: HTMLElement[] = []
  private lit = -1
  private readonly speed = el('div', 'race-speed')
  private readonly time = el('div', 'race-time')
  private readonly splitTime = el('div', 'race-split-time')
  private readonly splitDelta = el('div', 'race-split-delta')
  private readonly countdown = el('div', 'race-countdown')
  private readonly panel = el('div', 'race-panel')
  private readonly pause = el('div', 'race-pause')
  private readonly split = el('div', 'race-split')
  private splitTimer: ReturnType<typeof setTimeout> | undefined
  typing = false
  private pauseMenu: MenuList | null = null
  private finishMenu: MenuList | null = null
  private readonly pauseSettings = el('div', '')

  private readonly store: RaceStore
  private readonly actions: MenuActions | null

  constructor(store: RaceStore, actions: MenuActions | null = null) {
    this.store = store
    this.actions = actions
    this.status.append(this.lap, this.cp)
    this.chase.append(this.target, this.best)
    for (let i = 0; i < 3; i++) this.lights.append(el('i', ''))
    this.countdown.append(this.lights, this.count)
    this.countdown.hidden = true
    const gauge = el('div', 'race-gauge')
    const arc = el('div', 'race-ticks')
    for (let i = 0; i < SPEEDO_TICKS; i++) {
      const t = el('i', '')
      t.style.transform = `rotate(${-110 + (220 * i) / (SPEEDO_TICKS - 1)}deg)`
      this.ticks.push(t)
      arc.append(t)
    }
    gauge.append(arc, this.speed, el('div', 'race-unit', 'KM/H'))
    this.speedo.append(gauge, this.time)
    this.split.append(this.splitTime, this.splitDelta)
    document.body.append(this.status, this.chase, this.speedo, this.keys, this.countdown, this.panel, this.pause, this.split)
    this.split.hidden = true
    this.panel.hidden = true
    this.pause.hidden = true
    this.pauseSettings.hidden = true
    this.pause.append(el('h2', '', 'PAUSED'))
    if (actions) {
      this.pauseMenu = menuList([
        { label: 'Resume', action: () => actions.resume() },
        { label: 'Restart', action: () => actions.restart() },
        { label: 'Settings', action: () => this.toggleSettings() },
        { label: 'Back to menu', action: () => actions.backToMenu() },
      ])
      this.pause.append(this.pauseMenu.element, this.pauseSettings)
    }
    this.pause.append(el('p', '', 'Esc resume  [R] respawn  [⌫] restart  [L] leaderboard  [F] fullscreen  [1/2/3] camera  [C] fly  [H] debug'))
  }

  /** True while the Esc menu's settings panel is open (Esc closes it before resuming). */
  get settingsOpen(): boolean {
    return !this.pauseSettings.hidden
  }

  toggleSettings(): void {
    if (!this.actions) return
    if (this.pauseSettings.hidden) this.pauseSettings.replaceChildren(this.actions.settings())
    this.pauseSettings.hidden = !this.pauseSettings.hidden
  }

  /** Arrows / Enter for whichever menu is open; returns true when the key was used. */
  menuKey(code: string, paused: boolean): boolean {
    if (paused) return this.pauseMenu?.key(code) ?? false
    if (this.panel.hidden || this.typing) return false
    return this.finishMenu?.key(code) ?? false
  }

  render(s: HudState): void {
    setText(this.lap, `LAP ${s.lap}`)
    setText(this.cp, `CP ${s.checkpoints}`)
    setText(this.target, s.target ? `${s.target.label} ${formatLapTime(s.target.ms)}` : '')
    // The plate's left edge takes the medal colour too (border uses currentColor).
    this.chase.className = `race-chase race-medal-${s.target?.medal ?? 'best'}`
    this.chase.hidden = s.target === null && s.best === null && s.runBest === null
    const best = s.best === null ? '' : `BEST ${formatLapTime(s.best)}`
    const runBest = s.runBest === null ? '' : `RUN ${formatLapTime(s.runBest)}`
    // The target line already shows the best once every medal is earned.
    setText(this.best, [s.target?.medal === null ? '' : best, runBest].filter(Boolean).join('  '))
    setText(this.speed, String(s.speedKmh))
    setText(this.time, s.time)
    const lit = litTicks(s.speedKmh)
    if (lit !== this.lit) {
      this.ticks.forEach((t, i) => t.classList.toggle('on', i < lit))
      this.lit = lit
    }
  }

  /** Countdown step: 3, 2, 1 light the start lights red one by one and pop the number; 0 turns them green with GO!. */
  showCountdown(n: number): void {
    clearTimeout(this.countTimer)
    this.countdown.hidden = false
    ;[...this.lights.children].forEach((l, i) => (l.className = n === 0 ? 'go' : i < 4 - n ? 'on' : ''))
    this.count.textContent = n === 0 ? 'GO!' : String(n)
    this.count.className = `race-count${n === 0 ? ' race-go' : ''}`
    void this.count.offsetWidth // restart the pop animation on every step
    this.count.classList.add('race-pop')
    if (n === 0) this.countTimer = setTimeout(() => (this.countdown.hidden = true), GO_MS)
  }

  /** Pop a checkpoint split: run time plus its delta (blue ahead, red behind); null hides it. */
  showSplit(split: Split | null): void {
    clearTimeout(this.splitTimer)
    this.split.hidden = split === null
    if (split === null) return
    this.splitTime.textContent = formatLapTime(split.timeMs)
    const d = split.deltaMs
    this.splitDelta.textContent = d === null ? '' : formatDelta(d)
    this.split.className = `race-split ${d === null ? '' : Math.round(d) < 0 ? 'race-ahead' : 'race-behind'}`
    // Restart the pop-in / fade-out animation on every checkpoint, even back to back.
    void this.split.offsetWidth
    this.split.classList.add('race-pop')
    this.splitTimer = setTimeout(() => (this.split.hidden = true), SPLIT_MS)
  }

  showPause(paused: boolean): void {
    this.pause.hidden = !paused
    this.pauseSettings.hidden = true
    this.pauseMenu?.focus(0)
  }

  /**
   * `lapTimeMs` is the run total; `lapTimes` (multi-lap runs) are listed with the best lap marked; `deltaMs` is the
   * run vs the previous best (blue ahead, red behind), shown under the time instead of as a split pop-up.
   */
  showFinish(lapTimeMs: number, isNewBest: boolean, medals?: MedalResult, lapTimes: number[] = [], deltaMs: number | null = null): void {
    this.showSplit(null)
    this.panel.hidden = false
    this.panel.replaceChildren(el('h2', '', `${isNewBest ? 'NEW BEST! ' : ''}${formatLapTime(lapTimeMs)}`))
    if (deltaMs !== null) this.panel.append(el('div', `race-split-delta ${Math.round(deltaMs) < 0 ? 'race-ahead' : 'race-behind'}`, formatDelta(deltaMs)))
    if (lapTimes.length > 1) this.panel.append(lapList(lapTimes))
    if (medals) this.panel.append(medalLine(medals))
    if (!this.store.qualifies(lapTimeMs)) {
      this.panel.append(this.board(), this.finishActions())
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
      this.panel.replaceChildren(el('h2', '', formatLapTime(lapTimeMs)), this.board(lapTimeMs), this.finishActions())
    })
    this.panel.append(el('p', '', 'Top 10! Enter your name:'), name)
    name.focus()
  }

  hideFinish(): void {
    this.panel.hidden = true
    this.typing = false
    this.finishMenu = null
  }

  /** Improve (= restart) and Next track; plain hint when there are no menu actions. */
  private finishActions(): HTMLElement {
    const a = this.actions
    if (!a) return el('p', '', 'Backspace to race again')
    this.finishMenu = menuList([
      { label: 'Improve', action: () => a.restart() },
      { label: 'Next track', action: () => a.nextTrack() },
      { label: 'Back to menu', action: () => a.backToMenu() },
    ])
    return this.finishMenu.element
  }

  toggleLeaderboard(): void {
    if (!this.panel.hidden) return this.hideFinish()
    this.finishMenu = null
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

function lapList(lapTimes: number[]): HTMLElement {
  const best = Math.min(...lapTimes)
  const ol = el('ol', 'race-laps')
  lapTimes.forEach((ms, i) => ol.append(el('li', ms === best ? 'race-mine' : '', `LAP ${i + 1}  ${formatLapTime(ms)}${ms === best ? '  BEST' : ''}`)))
  return ol
}

function medalLine(m: MedalResult): HTMLElement {
  const box = el('div', 'race-medals')
  box.append(el('p', `race-medal race-medal-${m.earned ?? 'none'}`, m.earned ? `${MEDAL_LABEL[m.earned]} MEDAL` : 'NO MEDAL'))
  if (m.next && m.nextMs !== null) box.append(el('p', '', `Next: ${MEDAL_LABEL[m.next]} ${formatLapTime(m.nextMs)}`))
  if (m.best) box.append(el('p', '', `Best medal: ${MEDAL_LABEL[m.best]}`))
  return box
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.textContent = text
  return e
}
