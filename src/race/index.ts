// Race wiring for main.ts: one initRace() call, then race.frame() each frame in place of sim.advance().
// Keys: R = respawn at last checkpoint, Backspace = restart, L = toggle leaderboard.
import * as THREE from 'three/webgpu'
import { NO_INPUT, TICK_HZ, type CarInput, type FixedStepper } from '../physics'
import { poses, type Track } from '../track/schema'
import { LapLoop, type RaceEvents } from './lap'
import { formatLapTime, RaceStore } from './store'
import { FLAT_OVAL } from './tracks'
import { RaceView } from './view'

export type { RaceEvents } from './lap'

export interface RaceOptions {
  track?: Track
  /** Extra listeners, e.g. audio (onCheckpoint / onFinish / onRespawn) or the ghost recorder. */
  listeners?: RaceEvents[]
  storage?: Storage
}

export interface Race {
  loop: LapLoop
  /** Advances the sim (holding the car during the countdown) and updates lap state and HUD. */
  frame(elapsedSeconds: number, input: CarInput): void
}

export function initRace(scene: THREE.Scene, sim: FixedStepper, opts: RaceOptions = {}): Race {
  const track = opts.track ?? FLAT_OVAL
  const store = new RaceStore(opts.storage ?? localStorage)
  const loop = new LapLoop(track, (ms) => store.recordLap(ms))
  const view = new RaceView(store)
  for (const l of opts.listeners ?? []) loop.on(l)
  loop.on({
    lapFinish: (_t, ms, isNewBest) => view.showFinish(ms, isNewBest),
  })
  addGateMarkers(scene, track)
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

function addGateMarkers(scene: THREE.Scene, track: Track): void {
  const p = poses(track)
  for (const g of track.gates) {
    const pose = p[g.segment]
    const color = g.kind === 'start-finish' ? 0xffffff : 0xffc300
    const mat = new THREE.MeshStandardMaterial({ color })
    const gate = new THREE.Group()
    for (const side of [-8, 8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5), mat)
      post.position.set(side, 2, 0)
      gate.add(post)
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(16.5, 0.5, 0.5), mat)
    bar.position.set(0, 4, 0)
    gate.add(bar)
    gate.position.set(pose.x, pose.y, pose.z)
    gate.rotation.y = pose.heading
    scene.add(gate)
  }
}
