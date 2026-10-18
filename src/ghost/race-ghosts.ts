// The ghosts racing alongside the car: the session's personal best (replayed through the physics, ghost.ts) and the
// gold and author pace ghosts (pace.ts, recorded in a worker), each with a floating name tag (tags.ts) showing its
// time and gap at the last checkpoint the car passed. Which ones race is Settings → Race → Ghosts (`?ghosts=`).
import type * as THREE from 'three/webgpu'
import { TICK_HZ, type FixedStepper } from '../physics'
import type { RaceEvents } from '../race/lap'
import type { CarView } from '../render/car/model'
import type { Livery } from '../render/car/livery'
import type { Track } from '../track/schema'
import { GhostReplayer, type GhostRecorder, type GhostRun } from './ghost'
import { createGhostCar } from './mesh'
import { PaceGhost, type PaceLap } from './pace'
import { offeredGhosts, tagText, timeAtPoint, type GhostKind } from './tag'
import { createGhostTags, type TagInput } from './tags'

const TICK_MS = 1000 / TICK_HZ

/** Medal ghost paint: the medal's own colour. */
const MEDAL_LIVERY: Record<'gold' | 'author', Livery> = {
  gold: { pattern: 'solid', paint: 'yellow', number: 1 },
  author: { pattern: 'solid', paint: 'lime', number: 1 },
}

/** Start recording the medal pace lap in a worker; resolves null when it fails or the track has no lap. */
export function startPaceLap(track: Track): Promise<PaceLap | null> {
  if (!track.medals) return Promise.resolve(null)
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./pace.worker.ts', import.meta.url), { type: 'module' })
    const done = (lap: PaceLap | null) => {
      worker.terminate()
      resolve(lap)
    }
    worker.onmessage = (e: MessageEvent<PaceLap | null>) => done(e.data)
    worker.onerror = () => done(null)
    worker.postMessage(track)
  })
}

export interface RaceGhosts {
  /** The PB ghost's car (also posed by the `&ghost=show` debug shot). */
  readonly pbCar: CarView
  listener(): RaceEvents
  setPbLivery(l: Livery): void
  /** Pose every racing ghost and work out its tag; `hold` (flying) leaves them where they are, and before the first
   *  frame (a `freeze=1` debug shot) keeps them hidden. */
  frame(elapsed: number, opts: { paused: boolean; hold: boolean; selected: readonly GhostKind[]; laps: number }): void
  /** Place the tags, last in the frame: after the camera moved and the HUD they keep clear of updated. */
  drawTags(camera: THREE.Camera): void
}

export interface PbSlot {
  /** The run the PB ghost replays, read at each lap start: a challenge's ghost, else the session's fastest lap. */
  pbRun?: () => GhostRun | null
  /** Tag name for that run when it is not your own (a challenger's); it then races whatever the Ghosts setting says. */
  pbName?: string
}

export async function createRaceGhosts(
  scene: THREE.Scene,
  track: Track,
  sim: FixedStepper,
  recorder: GhostRecorder,
  pbLivery: Livery,
  paceLap: Promise<PaceLap | null>,
  slot: PbSlot = {},
): Promise<RaceGhosts> {
  const pbSource = slot.pbRun ?? (() => recorder.best)
  const [pbCar, gold, author] = await Promise.all([createGhostCar(undefined, pbLivery), createGhostCar(undefined, MEDAL_LIVERY.gold), createGhostCar(undefined, MEDAL_LIVERY.author)])
  const medalCars = { gold, author }
  scene.add(pbCar.object, medalCars.gold.object, medalCars.author.object)
  const tags = createGhostTags()
  let inputs: TagInput[] = []
  const checkpoints = track.gates.filter((g) => g.kind === 'checkpoint').length

  let pace: PaceLap | null = null
  void paceLap.then((lap) => (pace = lap))
  const medal = (kind: 'gold' | 'author'): PaceGhost | null => (pace && track.medals ? new PaceGhost(pace, track.medals[kind]) : null)
  let medals: Record<'gold' | 'author', PaceGhost | null> = { gold: null, author: null }

  // The PB lap this lap replays, fixed at lap start: the recorder may keep a faster one mid-lap (the lap just
  // finished commits a frame later), which races from the next lap on.
  let pbRun: GhostRun | null = null
  let pb: GhostReplayer | null = null
  let pbSplits: number[] = []
  // Held on the grid until the first GO.
  let lapStartTick = Number.POSITIVE_INFINITY
  /** Car checkpoint times this lap (ms), then its lap time once it crosses the line. */
  let carTimes: number[] = []
  let carFinished = false
  /** Checkpoint times of each finished lap, by lap time: the PB ghost's splits once the recorder keeps that lap. */
  const lapSplits = new Map<number, number[]>()

  const resetLap = (startTick: number) => {
    lapStartTick = startTick
    carTimes = []
    carFinished = false
    pbRun = pbSource()
    pb = pbRun ? new GhostReplayer(pbRun, sim.surface) : null
    // Splits are known only for your own laps; a challenge ghost shows its finish time until the line.
    pbSplits = pbRun && pbRun === recorder.best ? (lapSplits.get(pbRun.lapTimeMs) ?? []) : []
    medals = { gold: medal('gold'), author: medal('author') }
  }

  return {
    pbCar,
    setPbLivery: (l) => pbCar.setLivery(l),
    listener: () => ({
      // Each new lap (every lap of a multi-lap run too) replays the best single lap so far from its own start line.
      lapStart: (tick) => resetLap(tick),
      // Restart (Delete): put the ghosts back on the start grid with the car now, not after the countdown.
      // A fresh replayer has previous = state = run start, so it snaps there with no blend.
      restart: () => resetLap(Number.POSITIVE_INFINITY), // advanceTo(-Infinity) holds the start pose until lapStart
      checkpoint: (tick, index) => {
        carTimes[index - 1] = (tick - lapStartTick) * TICK_MS
        // Dev-only split log: the lap-2 ghost check compares these against the best lap.
        if (import.meta.env.DEV) console.info(`split: checkpoint ${index} at tick ${tick - lapStartTick}`)
      },
      lapFinish: (_tick, ms) => {
        lapSplits.set(ms, carTimes.slice(0, checkpoints))
        carTimes = [...carTimes.slice(0, checkpoints), ms]
        carFinished = true
      },
    }),
    frame(elapsed, { paused, hold, selected, laps }) {
      if (hold) return
      // A late pace lap (the worker still ran at GO) joins mid-lap at its own time.
      if (pace && !medals.gold) medals = { gold: medal('gold'), author: medal('author') }
      const offered = offeredGhosts(selected, { medals: track.medals !== undefined, laps, paceLap: pace !== null })
      const dt = paused ? 0 : elapsed
      const racing: { kind: GhostKind; car: CarView; splits: readonly number[]; lapMs: number; name?: string }[] = []
      // The replay advances even while hidden, so switching the PB ghost back on never re-simulates a whole lap in one frame.
      if (pb) pb.advanceTo(sim.state.tick - lapStartTick)
      if (pb && pbRun && (offered.includes('pb') || slot.pbName !== undefined)) {
        pbCar.update(pb.render(sim.alpha), dt)
        racing.push({ kind: 'pb', car: pbCar, splits: pbSplits, lapMs: pbRun.lapTimeMs, name: slot.pbName })
      }
      pbCar.object.visible = racing.some((r) => r.kind === 'pb')
      for (const kind of ['gold', 'author'] as const) {
        const g = medals[kind]
        const on = g !== null && offered.includes(kind)
        medalCars[kind].object.visible = on
        if (!on) continue
        medalCars[kind].update(g.at(sim.state.tick - lapStartTick - 1 + sim.alpha), dt)
        racing.push({ kind, car: medalCars[kind], splits: g.splits, lapMs: g.lapMs })
      }
      // The point the car passed last: checkpoint n, or the line (n + 1) once finished.
      const passed = carFinished ? checkpoints + 1 : carTimes.length
      const carMs = passed > 0 ? (carTimes[passed - 1] ?? null) : null
      const at = racing.map((r) => timeAtPoint(r.splits, r.lapMs, passed, checkpoints))
      const field = [...(carMs === null ? [] : [carMs]), ...at.filter((ms): ms is number => ms !== null)]
      inputs = racing.map((r, i) => ({
        kind: r.kind,
        position: r.car.object.position,
        text: at[i] === null || carMs === null ? tagText(r.kind, r.lapMs, null, [], r.name) : tagText(r.kind, at[i], carMs, field, r.name),
      }))
    },
    drawTags(camera) {
      if (inputs.length > 0) tags.update(inputs, camera)
      else tags.hide()
    },
  }
}
