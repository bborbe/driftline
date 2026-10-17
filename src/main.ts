import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, materialUnder, trackSurface } from './physics'
import { createCameraController } from './camera/controller'
import { flyQuery, flyRequested, wrapDeg } from './camera/fly'
import { mountDebugOverlay } from './debug/overlay'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { LAP_NAMES, lapName, loadLap, nextLap } from './track/registry'
import { beginAllowed, GameAudio, mountAudioControls } from './audio'
import { initRace } from './race'
import { lapCount } from './race/lap'
import { createGhostCar, GhostRecorder, GhostReplayer } from './ghost'
import { debugPose, debugRoll, frozen, poseQuery, yawDeg, yawRoll } from './race/debug-pose'
import { centreline } from './track/centreline'
import { loopTubes } from './track/pose'
import { rotate, v3 } from './physics/vec'
import { chooseTrack } from './menu/start'
import { skipMenu } from './menu/skip'
import { effectiveFxQuery, loadSettings, saveSettings } from './menu/settings'
import { settingsPanel } from './menu/settings-panel'
import { environmentLabel, resolveEnvironment } from './track/environment'

// A bare URL opens the start screen; ?track= and debug-spawn links go straight in (shared links, `make shots`).
const fromMenu = !skipMenu(location.search)
const trackName = fromMenu ? await chooseTrack(LAP_NAMES) : lapName(location.search)
const settings = loadSettings(localStorage)
const track = loadLap(trackName)
// Time of day and weather: ?time=&weather= override, else the track's default or (setting) a seeded random pick.
const env = resolveEnvironment(location.search, track, settings.environment, Date.now())
const view = await createView(track, effectiveFxQuery(location.search, settings), env, env.seed ?? 1)
const { camera, backend } = view

// Debug overlay (pose, fps, build label) in the corners; backtick or ?debug=0 hides it, P copies the debug-spawn URL
// for the current view. The race HUD lives in src/race/view.ts.
const debug = mountDebugOverlay({
  search: location.search,
  spawnLink: () => {
    const s = sim.state
    const fly = cam.fly
    return fly
      ? { query: flyQuery(lapName(location.search), fly), copied: 'copied fly view URL' }
      : { query: poseQuery(lapName(location.search), s.position, yawDeg(forwardOf(s))), copied: 'copied spawn URL' }
  },
})

const input = new KeyboardInput()
const audio = new GameAudio()
const laps = lapCount(location.search, settings.laps)
const sim = new FixedStepper(createCarAt(track.start), trackSurface(track))
// Inside a loop the overlay adds the car's up.y (−1 = upside down at the apex), so a shot can show it.
const inLoop = loopTubes(track)
const ghostRecorder = new GhostRecorder()
const ghostCar = await createGhostCar()
view.scene.add(ghostCar.object)
let ghost: GhostReplayer | null = null
let lapStartTick = 0
const race = initRace(sim, track, {
  listeners: [
    {
      countdown: (_t, n) => audio.onCountdown(n),
      checkpoint: () => audio.onCheckpoint(),
      // A lap line before the last lap chimes like a checkpoint.
      lapFinish: (_t, _ms, lap) => {
        if (lap < laps) audio.onCheckpoint()
      },
      raceFinish: () => audio.onFinish(),
      respawn: () => audio.onRespawn(),
      restart: () => audio.onRestart(),
    },
    ghostRecorder.listener(() => sim.state),
    {
      // Each new lap (every lap of a multi-lap run too) replays the best single lap so far from its own start line.
      lapStart: (tick) => {
        lapStartTick = tick
        ghost = ghostRecorder.best ? new GhostReplayer(ghostRecorder.best, sim.surface) : null
        ghostCar.object.visible = ghost !== null
      },
      // Backspace: put the ghost back on the start grid with the car now, not after the countdown.
      // A fresh replayer has previous = state = run start, so it snaps there with no blend.
      restart: () => {
        lapStartTick = Number.POSITIVE_INFINITY // advanceTo(-Infinity) holds the start pose until lapStart
        ghost = ghostRecorder.best ? new GhostReplayer(ghostRecorder.best, sim.surface) : null
        ghostCar.object.visible = ghost !== null
      },
      // Dev-only split log: the lap-2 ghost check compares these against the best lap.
      checkpoint: (tick, index) => {
        if (import.meta.env.DEV) console.info(`split: checkpoint ${index} at tick ${tick - lapStartTick}`)
      },
    },
  ],
  onPause: (paused) => void audio.setPaused(paused),
  menu: {
    backToMenu: () => location.assign(location.pathname),
    nextTrack: () => location.assign(`${location.pathname}?track=${nextLap(track.name)}`),
    settings: () => settingsPanel({ onVolume: (v) => audio.setVolume(v) }),
  },
  laps,
})
// Begin is ignored while paused (Esc; unpause first) and while flying (Space rises there).
mountAudioControls(audio, () => race.start(), () => beginAllowed(race.paused, cam.fly !== null), settings.volume, (volume) =>
  saveSettings(localStorage, { ...loadSettings(localStorage), volume }),
)
audio.setVolume(settings.volume)
// The card pick is the start gesture: skip the Begin overlay and go straight into the countdown.
if (fromMenu) document.getElementById('begin')?.click()
// Debug spawn for screenshots (docs/development.md § Debug screenshots): ?x&y&z&yaw places the car, freeze=1 holds it.
// With &cam=fly the same params (plus &pitch) place the free-fly camera instead, and the car stays on the grid.
const pose = debugPose(location.search)
const flyAtStart = flyRequested(location.search)
if (pose && !flyAtStart) sim.state = { ...createCarAt(pose), orientation: yawRoll(pose.heading, debugRoll(location.search)) }
const freeze = frozen(location.search)
if (freeze) document.getElementById('begin')?.remove()
// Camera views (1/2/3), free-fly (C, ?cam=fly) and orbit (O): while flying the race, ghost and audio hold still,
// and leaving fly mode carries the race on from the same tick.
const cam = createCameraController({
  camera,
  canvas: view.renderer.domElement,
  track,
  car: () => sim.state,
  onFly: (flying) => void audio.setPaused(flying || race.paused),
  pose,
  search: location.search,
  store: localStorage,
})
// The one keydown dispatch for the shell; race keys are handled inside src/race.
window.addEventListener('keydown', (e) => {
  debug.onKeyDown(e)
  cam.onKeyDown(e)
})
;(window as unknown as { driftline: object }).driftline = { centreline: (step: number) => centreline(track, step), ready: true }
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now
  const fly = cam.fly

  const carInput = input.read()
  if (!freeze && !fly) race.frame(elapsed, carInput)
  if (!fly) ghostRecorder.consume(sim.fed)
  if (ghost && !fly) {
    ghost.advanceTo(sim.state.tick - lapStartTick)
    ghostCar.update(ghost.render(sim.alpha), race.paused ? 0 : elapsed)
  }
  const s = sim.render()
  const material = materialUnder(s, sim.surface)
  if (!fly) audio.update(s, carInput, material)
  const speed = dot(s.velocity, forwardOf(s))

  view.car.visible = fly !== null || cam.viewMode !== 'cockpit'
  cam.frame(s, speed, elapsed, input.held())

  const f = cam.fly
  debug.setText(
    f
      ? `${backend}  ${track.name}  FLY${cam.orbiting ? ' ORBIT' : ''}  x ${f.position.x.toFixed(1)}  y ${f.position.y.toFixed(1)}  z ${f.position.z.toFixed(1)}  yaw ${wrapDeg((f.yaw * 180) / Math.PI).toFixed(0)}  pitch ${((f.pitch * 180) / Math.PI).toFixed(0)}  ·  WASD move  drag look  Space/Ctrl up/down (E/Q)  Shift fast  O orbit  C exit`
      : `${backend}  ${track.name}  ${environmentLabel(env)}  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}  yaw ${yawDeg(forwardOf(s)).toFixed(0)}${inLoop(s.position) ? `  up ${rotate(s.orientation, v3(0, 1, 0)).y.toFixed(2)}` : ''}${material === 'road' ? '' : `  ${material}`}${s.turbo > 0 ? '  TURBO' : ''}`,
  )
  view.frame(s, elapsed, material)
})
