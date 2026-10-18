// Race wiring for main.ts: one initRace() call, then race.frame() each frame in place of sim.advance().
// Gate arches are drawn by src/render; this module owns lap state, keys and the HUD overlay.
// Input is held until race.start() (the Begin click) and the 3-2-1 countdown are over.
// Keys (defaults, rebindable in Settings → Controls): Backspace / R = respawn at last checkpoint, Delete = restart (full 3-2-1-GO countdown), L = toggle leaderboard, T = records panel, F = fullscreen, H = controls help, Esc = pause menu (not when it only leaves fullscreen)
// (Resume / Restart / Settings / Back to menu, arrows + Enter or mouse; Esc again resumes).
// Checkpoints and lap lines flash the split delta vs the personal best; RESULTS_HOLD_MS after the finish the results
// card (results.ts, view.ts) shows medal (single-lap runs only), time, best, delta, one split row per checkpoint and lap
// line, and in a multi-lap run (`laps`) each lap time with the best one marked.
// Hiding the tab pauses too; the respawn / restart keys from the pause overlay act and resume.
import { dot, forwardOf, type CarInput, type FixedStepper } from '../physics'
import { layoutId, type Track } from '../track/schema'
import { chaseTarget, effectChips, kmh } from './hud'
import { isControlsKey } from './controls'
import { isRecordsKey, recordRows } from './records'
import { advanceRace, LapLoop, type RaceEvents } from './lap'
import { earnedMedal, nextMedal, SplitTracker } from './medals'
import { formatLapTime, RaceStore } from './store'
import { buildResults } from './results'
import { startBoard, type StartBoard } from './start-board'
import { escapeLeavesFullscreen, toggleFullscreen } from '../fullscreen'
import { RaceView } from './view'
import { BINDINGS_EVENT, isBound, loadBindings, type Bindings } from '../bindings'
import type { MenuActions } from './view'

export type { RaceEvents } from './lap'

export interface RaceOptions {
  /** Extra listeners, e.g. audio (onCheckpoint / onFinish / onRespawn) or the ghost recorder. */
  listeners?: RaceEvents[]
  storage?: Storage
  /** Called whenever pause toggles, e.g. to suspend audio. */
  onPause?: (paused: boolean) => void
  /** Esc-menu / finish-panel navigation; without it the pause overlay only shows key hints. */
  menu?: Pick<MenuActions, 'backToMenu' | 'nextTrack' | 'settings' | 'challenge'>
  /** Laps per run (default 1); `?laps=N` via lapCount, or the menu's Laps setting. Records are kept per lap count. */
  laps?: number
  /** True while the run may not set records (a dev-tuned run, src/debug/tuning.ts). */
  recordsLocked?: () => boolean
  /** The results card came in (true) or went (false); main.ts dims the scene behind it. */
  onResults?: (shown: boolean) => void
}

export interface Race {
  loop: LapLoop
  /** Laps in the current run. */
  readonly laps: number
  /** Settings → Laps: the lap count for the next restart (Backspace / Esc → Restart); the current run is unchanged. */
  setLaps(laps: number): void
  readonly paused: boolean
  /** True from the finish until the next restart: the results card is up or about to come in. */
  readonly resultsShown: boolean
  setPaused(paused: boolean): void
  /** Begin clicked: start the countdown. */
  start(): void
  /** What the start lights and start-arch screens show now (src/render/track/start-dressing.ts). */
  board(): StartBoard
  /** Advances the sim (no input before go, frozen after the finish), updates lap state, auto-respawns on a fall, draws the HUD. */
  frame(elapsedSeconds: number, input: CarInput): void
}

export function initRace(sim: FixedStepper, track: Track, opts: RaceOptions = {}): Race {
  let laps = opts.laps ?? 1
  let nextLaps = laps
  const newStore = () => new RaceStore(opts.storage ?? localStorage, track.name, layoutId(track), laps, opts.recordsLocked)
  let store = newStore()
  const loop = new LapLoop(track, (ms) => store.recordLap(ms), laps)
  // Medal targets are single-lap times.
  let medals = laps === 1 ? track.medals : undefined
  // Splits run over the whole run: each lap's checkpoints, then its line, numbered on from the lap before.
  const perLap = loop.checkpointCount + 1
  let pending: 'respawn' | 'restart' | null = null
  const menu = opts.menu
  const view = new RaceView(
    store,
    menu ? { ...menu, resume: () => setPaused(false), restart: () => (pending = 'restart') } : null,
  )
  view.onResults = opts.onResults ?? null
  const splits = new SplitTracker()
  // The best and its splits as they stood at the run start: the results card compares against these, not the run itself.
  let previousBest: number | null = null
  let previousSplits: number[] | null = null
  // Last countdown step (3, 2, 1, 0 = GO); null until the first one. Restart re-announces from 3.
  let step: number | null = null
  for (const l of opts.listeners ?? []) loop.on(l)
  loop.on({
    countdown: (_t, n) => {
      step = n
      view.showCountdown(n)
    },
    lapStart: (_t, lap) => {
      if (lap !== 1) return
      previousBest = store.best()
      previousSplits = previousBest === null ? null : store.bestSplits()
      splits.begin(previousBest, previousSplits)
    },
    checkpoint: (t, i) => {
      const timeMs = loop.lapTimeMs(t)
      view.showSplit({ timeMs, deltaMs: splits.checkpoint((loop.lap - 1) * perLap + i, timeMs) })
    },
    lapFinish: (t, _ms, lap) => {
      const timeMs = loop.lapTimeMs(t)
      if (lap < laps) view.showSplit({ timeMs, deltaMs: splits.checkpoint(lap * perLap, timeMs) })
    },
    raceFinish: (_t, ms, isNewBest, lapTimes) => {
      // store.best() is already this run when it is a new best; the delta is against the previous one.
      const deltaMs = splits.finish(ms)
      if (isNewBest) store.recordSplits(splits.splits)
      const medal = medals ? earnedMedal(medals, ms) : null
      if (medals) store.recordMedal(medal)
      const next = medals ? nextMedal(medal) : null
      view.showFinish(
        buildResults({
          ms,
          isNewBest,
          previousBest,
          deltaMs,
          lapTimes,
          splits: splits.splits,
          previousSplits,
          checkpoints: loop.checkpointCount,
          laps,
          medal: medals ? { earned: medal, next, nextMs: next && medals[next], best: store.bestMedal() } : null,
        }),
      )
    },
  })
  sim.state = loop.spawn()

  let paused = false
  const setPaused = (p: boolean) => {
    if (p === paused) return
    paused = p
    view.showPause(p)
    opts.onPause?.(p)
  }
  // Respawn and restart follow the player's key bindings (Settings → Controls), live.
  let bindings = loadBindings(localStorage)
  window.addEventListener(BINDINGS_EVENT, (e) => (bindings = (e as CustomEvent<Bindings>).detail))
  window.addEventListener('keydown', (e) => {
    if (view.typing) return
    if (e.code === 'KeyF' && !e.repeat) toggleFullscreen()
    if (e.code === 'Escape') {
      if (escapeLeavesFullscreen(!!document.fullscreenElement, performance.now())) return
      if (view.controlsOpen) view.toggleControls()
      else if (paused && view.settingsOpen) view.closeSubpanel()
      else setPaused(!paused)
      return
    }
    if ((e.target as HTMLElement | null)?.tagName !== 'INPUT' && view.menuKey(e.code, paused)) {
      e.preventDefault()
      return
    }
    if (isBound(bindings, 'respawn', e.code)) pending = 'respawn'
    if (isBound(bindings, 'restart', e.code)) pending = 'restart'
    if (e.code === 'KeyL') view.toggleLeaderboard()
    const tag = (e.target as HTMLElement | null)?.tagName
    if (isControlsKey(e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== 'INPUT' && tag !== 'SELECT') view.toggleControls()
    if (isRecordsKey(e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== 'INPUT' && tag !== 'SELECT') view.toggleRecords()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true)
  })

  return {
    loop,
    get paused() {
      return paused
    },
    get laps() {
      return laps
    },
    get resultsShown() {
      return view.resultsShown
    },
    setLaps(n) {
      nextLaps = n
    },
    setPaused,
    start() {
      loop.start(sim.state.tick)
    },
    board() {
      return startBoard(loop.phase, step, loop.lapTimeMs(sim.state.tick))
    },
    frame(elapsedSeconds, input) {
      if (pending === 'respawn' && loop.phase === 'racing') sim.state = loop.respawn(sim.state.tick)
      if (pending === 'restart') {
        if (nextLaps !== laps) {
          laps = nextLaps
          store = newStore()
          view.store = store
          medals = laps === 1 ? track.medals : undefined
        }
        sim.state = loop.restart(sim.state.tick, laps)
        view.hideFinish()
        view.showSplit(null)
      }
      if (pending) setPaused(false)
      pending = null
      advanceRace(loop, sim, elapsedSeconds, input, paused)
      const tick = sim.state.tick
      const s = sim.state
      view.render({
        speedKmh: loop.phase === 'finished' ? 0 : kmh(dot(s.velocity, forwardOf(s))),
        target: chaseTarget(medals, store.bestMedal(), store.best()),
        time: formatLapTime(loop.lapTimeMs(tick)),
        checkpoints: `${loop.passed}/${loop.checkpointCount}`,
        lap: `${loop.lap}/${laps}`,
        // A single-lap run's best is its only lap, which BEST already shows.
        runBest: laps > 1 ? loop.runBestMs : null,
        best: store.best(),
        effects: effectChips(loop.effects.active()),
        records: recordRows(medals, store.best()),
      })
    },
  }
}
