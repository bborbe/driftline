// DOM overlay: race HUD (timer bottom centre, speedometer bottom right, one race-status panel top right with the medal
// target + delta, lap and checkpoint, records panel top left (T: PB and medal times with deltas, top 5), split pop-up, checkpoint edge flash), start lights + 3-2-1-GO! countdown, controls help (H,
// and Controls in the Esc menu), the results card after the finish (#results-card: medal, time, best, delta, splits, name entry,
// Restart / Next track / Menu), leaderboard, Esc menu. A small "H — controls" hint fades out HINT_MS after the countdown starts.
// Sizes scale with --hud-scale (Settings → Graphics → HUD scale).
import './race.css'
import { menuList, type MenuList } from '../menu/list'
import { isMenuKey } from '../menu/nav'
import { controlsPanel } from './controls'
import { keysLabel, loadBindings } from '../bindings'
import { litTicks, SPEEDO_TICKS, targetDelta, type EffectChip, type Target } from './hud'
import { loadSettings, SETTINGS_EVENT, type Settings } from '../menu/settings'
import { formatDelta, MEDAL_LABEL } from './medals'
import { RESULTS_HOLD_MS, type MedalResult, type Results } from './results'
import { formatLapTime, type RaceStore } from './store'
import { LAMPS, startLamps, type Lamp } from './start-board'
import { CheckpointFlash } from './checkpoint-flash'
import { recordsOpen, RECORDS_TOP, type RecordRow, type RecordsChoice } from './records'

/** How long a split delta stays on screen. */
const SPLIT_MS = 2500
/** HUD start-light class per lamp (race.css). */
const LAMP_CLASS: Record<Lamp, string> = { off: '', red: 'on', green: 'go' }

/** How long GO! stays up after the countdown. */
const GO_MS = 900
/** How long the "H — controls" hint stays before it fades (race.css animates the same 4 s). */
export const HINT_MS = 4000

/** Restart a one-shot CSS animation class on `e` (lap / checkpoint / record transitions). */
function replay(e: HTMLElement, cls: string): void {
  e.classList.remove(cls)
  void e.offsetWidth
  e.classList.add(cls)
}

/** Sets the race-HUD size multiplier every HUD rule multiplies by. */
const applyHudScale = (scale: number): void => document.documentElement.style.setProperty('--hud-scale', String(scale))

export type { MedalResult } from './results'

/** In-race menu actions (Esc menu and finish panel). */
export interface MenuActions {
  resume(): void
  restart(): void
  backToMenu(): void
  nextTrack(): void
  /** A fresh settings panel (the same one the start screen shows). */
  settings(): HTMLElement
  /** Results → Challenge a friend: copy a challenge link for this run (src/challenge). Absent: no button. */
  challenge?(runMs: number): void
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
  /** Active effect pads, one chip each (none = hidden). */
  effects: EffectChip[]
  /** Records panel rows: the PB, then each medal with the best's delta to it (records.ts recordRows). */
  records: RecordRow[]
}

/** A split pop-up: the run time at the checkpoint and its delta vs the personal best (null without one). */
export interface Split {
  timeMs: number
  deltaMs: number | null
}

export class RaceView {
  private readonly keys = el('div', 'race-keys', 'H — controls')
  private readonly help = el('div', 'race-help')
  private readonly pauseControls = el('div', '')
  private readonly status = el('div', 'race-status')
  private readonly lap = el('div', 'race-lap')
  private readonly cp = el('div', 'race-cp')
  private readonly chase = el('div', 'race-chase')
  private readonly target = el('span', 'race-target')
  private readonly delta = el('span', 'race-target-delta')
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
  /** The results card; in the DOM only while results are shown. */
  private readonly card = el('div', 'race-results')
  private resultsTimer: ReturnType<typeof setTimeout> | undefined
  /** Hears the results card come and go (main.ts dims the scene behind it). */
  onResults: ((shown: boolean) => void) | null = null
  private readonly pause = el('div', 'race-pause')
  private readonly split = el('div', 'race-split')
  // Screen-edge glow on each checkpoint / lap-line pass, tinted like the split delta (checkpoint-flash.ts).
  private readonly cpFlash = el('div', 'race-cp-flash')
  private readonly flash = new CheckpointFlash()
  private flashShown = 0
  private readonly effects = el('div', 'race-effects')
  // Records panel, top left: header (always shown) over the medal rows and the top 5 (hidden while collapsed).
  private readonly records = el('div', 'race-records')
  private readonly recordRows = el('ol', 'race-records-rows')
  private readonly recordTop = el('ol', 'race-records-top')
  private recordsChoice: RecordsChoice
  /** Rows + board last drawn; the panel is rebuilt only when it changes. */
  private recordsKey = ''
  private effectsKey = ''
  private rendered = false
  private splitTimer: ReturnType<typeof setTimeout> | undefined
  typing = false
  /** While the name entry is up: Enter saves the name, Escape skips the board (the input's keys, or a pad's A / B). */
  private nameEntry: ((code: string) => void) | null = null
  private pauseMenu: MenuList | null = null
  private finishMenu: MenuList | null = null
  private readonly pauseSettings = el('div', '')

  /** Replaced when a restart changes the lap count (records are kept per lap count). */
  store: RaceStore
  private readonly actions: MenuActions | null

  constructor(store: RaceStore, actions: MenuActions | null = null) {
    this.store = store
    this.actions = actions
    // One race-status panel: medal target (+ the best's delta to it), lap, checkpoint, then best / run times.
    this.chase.append(el('i', 'race-medal-dot'), this.target, this.delta)
    this.status.append(this.chase, this.lap, this.cp, this.best)
    const head = el('div', 'race-records-head')
    head.append(el('span', '', 'RECORDS'), el('kbd', '', 'T'))
    const body = el('div', 'race-records-body')
    body.append(this.recordRows, el('h4', '', `TOP ${RECORDS_TOP}`), this.recordTop)
    this.records.append(head, body)
    this.recordsChoice = loadSettings(localStorage).records
    this.setRecordsOpen(recordsOpen(this.recordsChoice, window.innerWidth))
    this.keys.style.setProperty('--hint-delay', `${HINT_MS}ms`)
    applyHudScale(loadSettings(localStorage).hudScale)
    window.addEventListener(SETTINGS_EVENT, this.onSettings)
    for (let i = 0; i < LAMPS; i++) this.lights.append(el('i', ''))
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
    document.body.append(this.status, this.records, this.speedo, this.keys, this.countdown, this.panel, this.pause, this.split, this.effects, this.cpFlash)
    this.card.id = 'results-card'
    this.effects.hidden = true
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
        { label: 'Controls', action: () => this.togglePauseControls() },
        { label: 'Back to menu', action: () => actions.backToMenu() },
      ])
      this.pause.append(this.pauseMenu.element, this.pauseSettings, this.pauseControls)
    }
    this.pauseControls.hidden = true
    this.pause.append(el('p', '', 'Esc resume  ·  H controls'))
    this.help.hidden = true
    this.help.append(el('h2', '', 'CONTROLS'), controlsPanel(), el('p', '', 'H or Esc to close'))
    document.body.append(this.help)
  }

  /** Live HUD scale and records-panel choice from Settings → Graphics (a changed choice re-applies open / collapsed). */
  private readonly onSettings = (e: Event): void => {
    const s = (e as CustomEvent<Settings>).detail
    applyHudScale(s.hudScale)
    if (s.records === this.recordsChoice) return
    this.recordsChoice = s.records
    this.setRecordsOpen(recordsOpen(s.records, window.innerWidth))
  }

  /** True while the records panel shows its rows (false: collapsed to its header). */
  get recordsShown(): boolean {
    return !this.records.classList.contains('race-records-closed')
  }

  private setRecordsOpen(open: boolean): void {
    this.records.classList.toggle('race-records-closed', !open)
  }

  /** T: open or collapse the records panel for this page (Settings → Records panel sets how it starts). */
  toggleRecords(): void {
    this.setRecordsOpen(!this.recordsShown)
  }

  /** Drops the window listener (the game builds one RaceView per page; tests can build several). */
  dispose(): void {
    window.removeEventListener(SETTINGS_EVENT, this.onSettings)
  }

  /** True while the Esc menu's settings panel is open (Esc closes it before resuming). */
  get settingsOpen(): boolean {
    return !this.pauseSettings.hidden || !this.pauseControls.hidden
  }

  toggleSettings(): void {
    if (!this.actions) return
    if (this.pauseSettings.hidden) this.pauseSettings.replaceChildren(this.actions.settings())
    this.pauseSettings.hidden = !this.pauseSettings.hidden
    this.pauseControls.hidden = true
  }

  /** Closes the Esc menu's Settings / Controls page, back to the menu list. */
  closeSubpanel(): void {
    this.pauseSettings.hidden = true
    this.pauseControls.hidden = true
  }

  /** The Esc menu's Controls page (the same list H shows in-race). */
  private togglePauseControls(): void {
    if (this.pauseControls.hidden) this.pauseControls.replaceChildren(controlsPanel())
    this.pauseControls.hidden = !this.pauseControls.hidden
    this.pauseSettings.hidden = true
  }

  /** True while the in-race controls panel (H) is up; Esc closes it before pausing. */
  get controlsOpen(): boolean {
    return !this.help.hidden
  }

  toggleControls(): void {
    this.help.hidden = !this.help.hidden
  }

  /** Arrows / Enter for whichever menu is open; returns true when the key was used. */
  menuKey(code: string, paused: boolean): boolean {
    // With Settings open the panel's pad focus owns the menu keys (src/menu/pad-focus.ts); the list behind stays put.
    if (paused && !this.pauseSettings.hidden) return isMenuKey(code)
    if (paused) return this.pauseMenu?.key(code) ?? false
    if ((this.panel.hidden && !this.card.isConnected) || this.typing) return false
    return this.finishMenu?.key(code) ?? false
  }

  render(s: HudState): void {
    const effectsKey = s.effects.map((c) => c.label).join('|')
    if (effectsKey !== this.effectsKey) {
      this.effectsKey = effectsKey
      this.effects.replaceChildren(
        ...s.effects.map((c) => {
          const chip = el('span', 'race-effect', c.label)
          chip.style.setProperty('--effect', c.color)
          return chip
        }),
      )
      this.effects.hidden = s.effects.length === 0
    }
    // Only touch the style while a flash runs or has just ended.
    const flash = this.flash.opacity(performance.now() / 1000)
    if (flash > 0 || this.flashShown > 0) this.cpFlash.style.opacity = String(flash)
    this.flashShown = flash
    // Lap and checkpoint pulse when they change (not on the first frame).
    if (setText(this.lap, `LAP ${s.lap}`) && this.rendered) replay(this.lap, 'race-bump')
    if (setText(this.cp, `CP ${s.checkpoints}`) && this.rendered) replay(this.cp, 'race-bump')
    this.rendered = true
    setText(this.target, s.target ? `${s.target.label} ${formatLapTime(s.target.ms)}` : '')
    const d = targetDelta(s.target, s.best)
    setText(this.delta, d === null ? '' : formatDelta(d))
    this.delta.className = `race-target-delta ${d === null ? '' : Math.round(d) < 0 ? 'race-ahead' : 'race-behind'}`
    // The medal dot takes the target medal's colour (currentColor).
    this.chase.className = `race-chase race-medal-${s.target?.medal ?? 'best'}`
    this.chase.hidden = s.target === null
    const best = s.best === null ? '' : `BEST ${formatLapTime(s.best)}`
    const runBest = s.runBest === null ? '' : `RUN ${formatLapTime(s.runBest)}`
    // The target line already shows the best once every medal is earned.
    setText(this.best, [s.target?.medal === null ? '' : best, runBest].filter(Boolean).join('  '))
    this.renderRecords(s.records)
    setText(this.speed, String(s.speedKmh))
    setText(this.time, s.time)
    const lit = litTicks(s.speedKmh)
    if (lit !== this.lit) {
      this.ticks.forEach((t, i) => t.classList.toggle('on', i < lit))
      this.lit = lit
    }
  }

  /** Rebuilds the records panel when its rows or the stored board changed (one localStorage read per frame). */
  private renderRecords(rows: RecordRow[]): void {
    const board = this.store.leaderboard().slice(0, RECORDS_TOP)
    const key = JSON.stringify([rows, board])
    if (key === this.recordsKey) return
    this.recordsKey = key
    this.recordRows.replaceChildren(
      ...rows.map((r) => {
        const li = el('li', `race-rec race-medal-${r.kind}`)
        const delta = el('span', `race-rec-delta ${r.delta === null ? '' : r.delta.beaten ? 'race-beaten' : 'race-behind'}`, r.delta?.text ?? '')
        li.append(el('i', 'race-medal-dot'), el('span', 'race-rec-label', r.label), el('span', 'race-rec-time', r.ms === null ? '-:--.---' : formatLapTime(r.ms)), delta)
        return li
      }),
    )
    const top = board.map((e) => {
      const li = el('li', '')
      li.append(el('span', 'race-rec-label', e.name), el('span', 'race-rec-time', formatLapTime(e.lapTimeMs)))
      return li
    })
    this.recordTop.replaceChildren(...(top.length > 0 ? top : [el('li', 'race-rec-empty', 'No laps yet')]))
  }

  /** Countdown step: 3, 2, 1 light the start lights red one by one and pop the number; 0 turns them green with GO!. */
  showCountdown(n: number): void {
    clearTimeout(this.countTimer)
    // The controls hint stays up until the first race of the page starts, then fades HINT_MS after its countdown begins
    // (once per page load: a restart does not bring it back).
    this.keys.classList.add('race-hint')
    this.countdown.hidden = false
    const lamps = startLamps(n)
    ;[...this.lights.children].forEach((l, i) => (l.className = LAMP_CLASS[lamps[i]]))
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
    this.cpFlash.className = `race-cp-flash ${d === null ? '' : Math.round(d) < 0 ? 'race-ahead' : 'race-behind'}`
    this.flash.trigger(performance.now() / 1000)
    this.splitTimer = setTimeout(() => (this.split.hidden = true), SPLIT_MS)
  }

  showPause(paused: boolean): void {
    this.pause.hidden = !paused
    this.pauseSettings.hidden = true
    this.pauseControls.hidden = true
    this.pauseMenu?.focus(0)
  }

  /** True while the results card is up (or about to come in after the finish orbit). */
  get resultsShown(): boolean {
    return this.card.isConnected || this.resultsTimer !== undefined
  }

  /** The finish: the orbit plays clear of the HUD for RESULTS_HOLD_MS, then the results card comes in. */
  showFinish(r: Results): void {
    this.showSplit(null)
    clearTimeout(this.resultsTimer)
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = undefined
      this.showResults(r)
    }, RESULTS_HOLD_MS)
  }

  private showResults(r: Results): void {
    const c = this.card
    c.replaceChildren()
    const medal = r.medal?.earned ?? null
    const head = el('div', 'race-results-head')
    if (r.medal) head.append(el('span', `race-results-medal race-medal-${medal ?? 'none'}`, medal ? MEDAL_LABEL[medal] : 'NO MEDAL'))
    const time = el('div', 'race-results-time')
    if (r.isNewBest) time.append(el('div', 'race-record', 'NEW BEST!'))
    time.append(el('h2', '', formatLapTime(r.ms)))
    head.append(time)
    c.append(head)
    const row = el('div', 'race-results-row')
    row.append(el('span', 'race-results-best', r.previousBest === null ? 'FIRST FINISH' : `BEST ${formatLapTime(r.previousBest)}`))
    if (r.deltaMs !== null) row.append(el('span', `race-split-delta ${Math.round(r.deltaMs) < 0 ? 'race-ahead' : 'race-behind'}`, formatDelta(r.deltaMs)))
    c.append(row)
    if (r.lapTimes.length > 1) c.append(lapList(r.lapTimes))
    if (r.splits.length > 0) c.append(splitTable(r))
    if (r.medal) c.append(medalLine(r.medal))
    document.body.append(c)
    replay(c, 'race-results-in')
    this.onResults?.(true)
    if (!this.store.qualifies(r.ms)) {
      c.append(this.finishActions(r.ms))
      return
    }
    const name = document.createElement('input')
    name.maxLength = 12
    name.value = this.store.lastName()
    name.placeholder = 'NAME'
    this.typing = true
    const entry = el('div', 'race-results-entry')
    const close = (line: HTMLElement) => {
      this.typing = false
      this.nameEntry = null
      entry.replaceChildren(line)
      c.append(this.finishActions(r.ms))
    }
    this.nameEntry = (code) => {
      if (code === 'Enter' || code === 'NumpadEnter') {
        this.store.addToLeaderboard(name.value, r.ms)
        const rank = this.store.leaderboard().findIndex((x) => x.lapTimeMs === r.ms) + 1
        close(el('p', 'race-mine', `#${rank} on board — ${name.value.toUpperCase() || 'ANON'}`))
      } else if (code === 'Escape') close(el('p', '', 'Not saved to the board'))
    }
    name.addEventListener('keydown', (e) => {
      e.stopPropagation()
      this.nameKey(e.key === 'Enter' ? 'Enter' : e.code)
    })
    entry.append(el('p', '', 'Top 10! Enter your name:'), name, el('p', 'menu-hint', 'Enter / A save · Esc / B skip'))
    c.append(entry)
    name.focus()
  }

  /** A key while the name entry is up (Enter saves, Escape skips); keys that reach the window, like the pad's, land here too. */
  nameKey(code: string): void {
    this.nameEntry?.(code)
  }

  hideFinish(): void {
    this.nameEntry = null
    clearTimeout(this.resultsTimer)
    this.resultsTimer = undefined
    const shown = this.card.isConnected
    this.card.remove()
    this.panel.hidden = true
    this.typing = false
    this.finishMenu = null
    if (shown) this.onResults?.(false)
  }

  /** Restart (primary), Next track, Challenge a friend and Menu; plain hint when there are no menu actions. */
  private finishActions(runMs: number): HTMLElement {
    const a = this.actions
    if (!a) return el('p', '', `${keysLabel(loadBindings(localStorage), 'restart')} to race again`)
    const challenge = a.challenge
    this.finishMenu = menuList(
      [
        { label: 'Restart', action: () => a.restart() },
        { label: 'Next track', action: () => a.nextTrack() },
        ...(challenge ? [{ label: 'Challenge a friend', action: () => challenge(runMs) }] : []),
        { label: 'Menu', action: () => a.backToMenu() },
      ],
      'menu-list race-results-actions',
    )
    return this.finishMenu.element
  }

  toggleLeaderboard(): void {
    if (this.resultsShown) return
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

/**
 * "Where did I lose time": one row per checkpoint and lap line — this run's split, the previous best's split and the
 * delta, then the sector before it against the previous best's sector (blue ahead, red behind). The sector that lost
 * the most time is highlighted.
 */
function splitTable(r: Results): HTMLElement {
  const table = el('table', 'race-results-splits')
  const head = el('tr', '')
  head.append(el('th', '', 'CP'), el('th', '', 'SPLIT'), el('th', '', 'PB'), el('th', '', 'Δ'), el('th', '', 'SECTOR'), el('th', '', 'Δ SEC'))
  table.append(head)
  const delta = (d: number | null) => el('td', d === null ? '' : Math.round(d) < 0 ? 'race-ahead' : 'race-behind', d === null ? '—' : formatDelta(d))
  for (const s of r.splits) {
    const tr = el('tr', s.worst ? 'race-results-worst' : '')
    tr.dataset.split = s.label
    if (s.worst) tr.title = 'Most time lost here'
    tr.append(el('td', '', s.label), el('td', '', formatLapTime(s.ms)), el('td', 'race-results-pb', s.pbMs === null ? '—' : formatLapTime(s.pbMs)), delta(s.deltaMs), el('td', '', formatLapTime(s.sectorMs)), delta(s.sectorDeltaMs))
    table.append(tr)
  }
  return table
}

function medalLine(m: MedalResult): HTMLElement {
  const box = el('div', 'race-medals')
  box.append(el('p', `race-medal race-medal-${m.earned ?? 'none'}`, m.earned ? `${MEDAL_LABEL[m.earned]} MEDAL` : 'NO MEDAL'))
  if (m.next && m.nextMs !== null) box.append(el('p', '', `Next: ${MEDAL_LABEL[m.next]} ${formatLapTime(m.nextMs)}`))
  if (m.best) box.append(el('p', '', `Best medal: ${MEDAL_LABEL[m.best]}`))
  return box
}

/** Sets the text when it differs; true when it changed. */
function setText(e: HTMLElement, text: string): boolean {
  if (e.textContent === text) return false
  e.textContent = text
  return true
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.textContent = text
  return e
}
