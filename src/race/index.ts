// Race wiring for main.ts: one initRace() call, then race.frame() each frame in place of sim.advance().
// Gate arches are drawn by src/render; this module owns lap state, keys and the HUD overlay.
// Input is held until race.start() (the Begin click) and the 3-2-1 countdown are over.
// Keys: R = respawn at last checkpoint, Backspace = restart, L = toggle leaderboard, Esc = pause.
// Hiding the tab pauses too; R / Backspace from the pause overlay act and resume.
import { TICK_HZ, type CarInput, type FixedStepper } from '../physics'
import { layoutId, type Track } from '../track/schema'
import { advanceRace, LapLoop, type RaceEvents } from './lap'
import { formatLapTime, RaceStore } from './store'
import { RaceView } from './view'

export type { RaceEvents } from './lap'

export interface RaceOptions {
  /** Extra listeners, e.g. audio (onCheckpoint / onFinish / onRespawn) or the ghost recorder. */
  listeners?: RaceEvents[]
  storage?: Storage
  /** Called whenever pause toggles, e.g. to suspend audio. */
  onPause?: (paused: boolean) => void
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
  const store = new RaceStore(opts.storage ?? localStorage, track.name, layoutId(track))
  const loop = new LapLoop(track, (ms) => store.recordLap(ms))
  const view = new RaceView(store)
  for (const l of opts.listeners ?? []) loop.on(l)
  loop.on({
    lapFinish: (_t, ms, isNewBest) => view.showFinish(ms, isNewBest),
  })
  sim.state = loop.spawn()

  let pending: 'respawn' | 'restart' | null = null
  let paused = false
  const setPaused = (p: boolean) => {
    if (p === paused) return
    paused = p
    view.showPause(p)
    opts.onPause?.(p)
  }
  window.addEventListener('keydown', (e) => {
    if (view.typing) return
    if (e.code === 'Escape') setPaused(!paused)
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
        best: store.best(),
      })
    },
  }
}
