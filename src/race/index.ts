// Race wiring for main.ts: one initRace() call, then race.frame() each frame in place of sim.advance().
// Gate arches are drawn by src/render; this module owns lap state, keys and the HUD overlay.
// Keys: R = respawn at last checkpoint, Backspace = restart, L = toggle leaderboard.
import { NO_INPUT, TICK_HZ, type CarInput, type FixedStepper } from '../physics'
import type { Track } from '../track/schema'
import { LapLoop, type RaceEvents } from './lap'
import { formatLapTime, RaceStore } from './store'
import { RaceView } from './view'

export type { RaceEvents } from './lap'

export interface RaceOptions {
  /** Extra listeners, e.g. audio (onCheckpoint / onFinish / onRespawn) or the ghost recorder. */
  listeners?: RaceEvents[]
  storage?: Storage
}

export interface Race {
  loop: LapLoop
  /** Advances the sim (holding the car during the countdown) and updates lap state and HUD. */
  frame(elapsedSeconds: number, input: CarInput): void
}

export function initRace(sim: FixedStepper, track: Track, opts: RaceOptions = {}): Race {
  const store = new RaceStore(opts.storage ?? localStorage)
  const loop = new LapLoop(track, (ms) => store.recordLap(ms))
  const view = new RaceView(store)
  for (const l of opts.listeners ?? []) loop.on(l)
  loop.on({
    lapFinish: (_t, ms, isNewBest) => view.showFinish(ms, isNewBest),
  })
  sim.state = loop.spawn()

  let pending: 'respawn' | 'restart' | null = null
  window.addEventListener('keydown', (e) => {
    if (view.typing) return
    if (e.code === 'KeyR') pending = 'respawn'
    if (e.code === 'Backspace') pending = 'restart'
    if (e.code === 'KeyL') view.toggleLeaderboard()
  })

  return {
    loop,
    frame(elapsedSeconds, input) {
      if (pending === 'respawn' && loop.phase === 'racing') sim.state = loop.respawn(sim.state.tick)
      if (pending === 'restart') {
        sim.state = loop.restart(sim.state.tick)
        view.hideFinish()
      }
      pending = null
      const hold = loop.frozen || loop.phase === 'finished'
      sim.advance(elapsedSeconds, hold ? NO_INPUT : input)
      if (loop.frozen) sim.state = { ...loop.spawn(), tick: sim.state.tick }
      loop.update(sim.state)
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
