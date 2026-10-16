// Race wiring for main.ts: one initRace() call, then race.frame() each frame in place of sim.advance().
// Gate arches are drawn by src/render; this module owns lap state, keys and the HUD overlay.
// Input is held until race.start() (the Begin click) and the 3-2-1 countdown are over.
// Keys: R = respawn at last checkpoint, Backspace = instant restart (short countdown), L = toggle leaderboard, F = fullscreen, Esc = pause menu (not when it only leaves fullscreen)
// (Resume / Restart / Settings / Back to menu, arrows + Enter or mouse; Esc again resumes).
// Checkpoints, lap lines and the finish flash the split delta vs the personal best; the finish panel shows
// medals (single-lap runs only) and, in a multi-lap run (`laps`), each lap time with the best one marked.
// Hiding the tab pauses too; R / Backspace from the pause overlay act and resume.
import { TICK_HZ, type CarInput, type FixedStepper } from '../physics'
import { layoutId, type Track } from '../track/schema'
import { advanceRace, LapLoop, type RaceEvents } from './lap'
import { earnedMedal, nextMedal, SplitTracker } from './medals'
import { formatLapTime, RaceStore } from './store'
import { escapeLeavesFullscreen, toggleFullscreen } from '../fullscreen'
import { RaceView } from './view'
import type { MenuActions } from './view'

export type { RaceEvents } from './lap'

export interface RaceOptions {
  /** Extra listeners, e.g. audio (onCheckpoint / onFinish / onRespawn) or the ghost recorder. */
  listeners?: RaceEvents[]
  storage?: Storage
  /** Called whenever pause toggles, e.g. to suspend audio. */
  onPause?: (paused: boolean) => void
  /** Esc-menu / finish-panel navigation; without it the pause overlay only shows key hints. */
  menu?: Pick<MenuActions, 'backToMenu' | 'nextTrack' | 'settings'>
  /** Laps per run (default 1); `?laps=N` via lapCount, or the menu's Laps setting. Records are kept per lap count. */
  laps?: number
}

export interface Race {
  loop: LapLoop
  readonly paused: boolean
  setPaused(paused: boolean): void
  /** Begin clicked: start the countdown. */
  start(): void
  /** Advances the sim (no input before go, frozen after the finish), updates lap state, auto-respawns on a fall, draws the HUD. */
  frame(elapsedSeconds: number, input: CarInput): void
}

export function initRace(sim: FixedStepper, track: Track, opts: RaceOptions = {}): Race {
  const laps = opts.laps ?? 1
  const store = new RaceStore(opts.storage ?? localStorage, track.name, layoutId(track), laps)
  const loop = new LapLoop(track, (ms) => store.recordLap(ms), laps)
  // Medal targets are single-lap times.
  const medals = laps === 1 ? track.medals : undefined
  // Splits run over the whole run: each lap's checkpoints, then its line, numbered on from the lap before.
  const perLap = loop.checkpointCount + 1
  let pending: 'respawn' | 'restart' | null = null
  const menu = opts.menu
  const view = new RaceView(
    store,
    menu ? { ...menu, resume: () => setPaused(false), restart: () => (pending = 'restart') } : null,
  )
  const splits = new SplitTracker()
  for (const l of opts.listeners ?? []) loop.on(l)
  loop.on({
    lapStart: (_t, lap) => {
      if (lap === 1) splits.begin(store.best(), store.bestSplits())
    },
    checkpoint: (t, i) => view.showSplit(splits.checkpoint((loop.lap - 1) * perLap + i, loop.lapTimeMs(t))),
    lapFinish: (t, _ms, lap) => {
      if (lap < laps) view.showSplit(splits.checkpoint(lap * perLap, loop.lapTimeMs(t)))
    },
    raceFinish: (_t, ms, isNewBest, lapTimes) => {
      // store.best() is already this run when it is a new best; the delta is against the previous one.
      view.showSplit(splits.finish(ms))
      if (isNewBest) store.recordSplits(splits.splits)
      const medal = medals ? earnedMedal(medals, ms) : null
      if (medals) store.recordMedal(medal)
      const next = medals ? nextMedal(medal) : null
      view.showFinish(ms, isNewBest, medals && { earned: medal, next, nextMs: next && medals[next], best: store.bestMedal() }, lapTimes)
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
  window.addEventListener('keydown', (e) => {
    if (view.typing) return
    if (e.code === 'KeyF' && !e.repeat) toggleFullscreen()
    if (e.code === 'Escape') {
      if (escapeLeavesFullscreen(!!document.fullscreenElement, performance.now())) return
      if (paused && view.settingsOpen) view.toggleSettings()
      else setPaused(!paused)
      return
    }
    if ((e.target as HTMLElement | null)?.tagName !== 'INPUT' && view.menuKey(e.code, paused)) {
      e.preventDefault()
      return
    }
    if (e.code === 'KeyR') pending = 'respawn'
    if (e.code === 'Backspace') pending = 'restart'
    if (e.code === 'KeyL') view.toggleLeaderboard()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true)
  })

  return {
    loop,
    get paused() {
      return paused
    },
    setPaused,
    start() {
      loop.start(sim.state.tick)
    },
    frame(elapsedSeconds, input) {
      if (pending === 'respawn' && loop.phase === 'racing') sim.state = loop.respawn(sim.state.tick)
      if (pending === 'restart') {
        sim.state = loop.restart(sim.state.tick)
        view.hideFinish()
        view.showSplit(null)
      }
      if (pending) setPaused(false)
      pending = null
      advanceRace(loop, sim, elapsedSeconds, input, paused)
      const tick = sim.state.tick
      const left = loop.countdownLeft(tick)
      view.render({
        countdown: loop.phase === 'countdown' ? Math.ceil(left / TICK_HZ) : null,
        time: formatLapTime(loop.lapTimeMs(tick)),
        checkpoints: `${loop.passed}/${loop.checkpointCount}`,
        lap: laps > 1 ? `${loop.lap}/${laps}` : null,
        best: store.best(),
      })
    },
  }
}
