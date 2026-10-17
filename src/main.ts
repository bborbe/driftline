import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, materialUnder, trackSurface } from './physics'
import { createCameraController } from './camera/controller'
import { flyQuery, flyRequested, wrapDeg, type FlyCam } from './camera/fly'
import { CAMERA_EVENT, loadView, saveView, type ViewMode } from './camera/views'
import { mountDebugOverlay } from './debug/overlay'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { LAP_NAMES, lapName, loadLap, nextLap } from './track/registry'
import { beginAllowed, GameAudio, KerbProbe, mountAudioControls, mountUiSounds } from './audio'
import { initRace } from './race'
import { lapCount } from './race/lap'
import { createGhostCar, GhostRecorder, GhostReplayer } from './ghost'
import { debugPose, debugRoll, frozen, poseQuery, yawDeg, yawRoll } from './race/debug-pose'
import { centreline } from './track/centreline'
import { loopTubes } from './track/pose'
import { rotate, v3 } from './physics/vec'
import { chooseTrack } from './menu/start'
import { skipMenu } from './menu/skip'
import { effectiveFxQuery, loadSettings, saveSettings, SETTINGS_EVENT, type Settings } from './menu/settings'
import { settingsChange } from './menu/live'
import { screenQuery, settingsFromUrl, startUrlSync, viewFromUrl, type Screen, type UrlState } from './menu/url-state'
import { clampLivery, ghostLivery } from './render/car/livery'
import { settingsPanel } from './menu/settings-panel'
import { environmentLabel, resolveEnvironment, trackEnvironment } from './track/environment'
import { devMode, RunTaint } from './debug/tuning'
import { mountTuningPanel } from './debug/tuning-panel'
import { isTuned } from './physics/handling'

// URL state (src/menu/url-state.ts): settings and the view named in the query beat the stored ones and are stored,
// so every panel shows them; from here on the address bar follows the screen, every setting, the view and the fly
// pose (replaceState, 4 Hz), so CMD+R lands on the same screen with the same setup. A race reload starts on the grid.
// The sync reads this tab's own state, never localStorage, which another tab may rewrite under it.
let shown = settingsFromUrl(location.search, loadSettings(localStorage))
let shownView: ViewMode = viewFromUrl(location.search, loadView(localStorage))
saveSettings(localStorage, shown)
saveView(localStorage, shownView)
window.addEventListener(SETTINGS_EVENT, (e) => (shown = (e as CustomEvent<Settings>).detail))
// Audio exists before the start screen so its menu clicks sound (a click may create the context: src/audio/ui-sounds.ts).
// ?audiolog=1 keeps an event trace on window.__driftlineAudio for automated checks (squeal, kerb, impact, ui, one-shots).
const audio = new GameAudio()
const applyVolumes = (s: Settings) => {
  audio.setVolume(s.volume)
  audio.setSfxVolume(s.sfxVolume)
  audio.setUiVolume(s.uiVolume)
}
applyVolumes(shown)
window.addEventListener(SETTINGS_EVENT, (e) => applyVolumes((e as CustomEvent<Settings>).detail))
if (new URLSearchParams(location.search).get('audiolog') === '1') {
  audio.enableTrace()
  ;(window as unknown as { __driftlineAudio: GameAudio['trace'] }).__driftlineAudio = audio.trace
}
mountUiSounds((sound, detail) => audio.playUi(sound, detail))
window.addEventListener(CAMERA_EVENT, (e) => (shownView = (e as CustomEvent<ViewMode>).detail))
// A bare URL opens the start screen; ?track= and debug-spawn links go straight in (shared links, `make shots`).
const fromMenu = !skipMenu(location.search)
const sel = new URLSearchParams(location.search).get('sel')
let screen: Screen = fromMenu ? { sel } : { track: lapName(location.search) }
let flying = (): FlyCam | null | undefined => undefined
let orbiting = () => false
let viewNow = (): ViewMode => shownView
const boot = location.search
const urlState = (): UrlState => ({ settings: shown, view: viewNow(), screen, fly: flying(), orbiting: orbiting(), boot })
startUrlSync(urlState)
const trackName = fromMenu ? await chooseTrack(LAP_NAMES, { focus: sel, onFocus: (track) => (screen = { sel: track }) }) : lapName(location.search)
screen = { track: trackName }
const settings = loadSettings(localStorage)
const track = loadLap(trackName)
// Time of day and weather: ?time=&weather= override, else the track's default or (setting) a seeded random pick.
let env = resolveEnvironment(location.search, track, settings, Date.now())
const view = await createView(track, effectiveFxQuery(location.search, settings), env, env.seed ?? 1, settings.livery)
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

// Dev tuning (?dev=1): F2 opens the handling sliders, the stored tune is loaded before the first tick, and a run that
// ran tuned at any point sets no records or ghosts (src/debug/tuning.ts).
const tuning = devMode(location.search) ? mountTuningPanel(localStorage) : null
const taint = new RunTaint()
taint.runStart(isTuned())
const input = new KeyboardInput()
const kerbs = new KerbProbe(track)
const laps = lapCount(location.search, settings.laps)
const sim = new FixedStepper(createCarAt(track.start), trackSurface(track))
// Inside a loop the overlay adds the car's up.y (−1 = upside down at the apex), so a shot can show it.
const inLoop = loopTubes(track)
const ghostRecorder = new GhostRecorder()
ghostRecorder.locked = () => taint.locked
const ghostCar = await createGhostCar(undefined, ghostLivery(settings.livery))
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
        if (lap < race.laps) audio.onCheckpoint()
      },
      raceFinish: (_t, _ms, isNewBest) => {
        audio.onFinish()
        if (isNewBest) audio.onNewRecord()
      },
      respawn: () => audio.onRespawn(),
      restart: () => audio.onRestart(),
    },
    {
      lapStart: (_tick, lap) => {
        if (lap === 1) taint.runStart(isTuned())
      },
      restart: () => taint.runStart(isTuned()),
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
    backToMenu: () => location.assign(`${location.pathname}${screenQuery(location.search, urlState(), { sel: trackName })}`),
    nextTrack: () => location.assign(`${location.pathname}${screenQuery(location.search, urlState(), { track: nextLap(track.name) })}`),
    settings: () => settingsPanel({ onVolume: (v) => audio.setVolume(v), trackDefault: trackEnvironment(track) }),
  },
  laps,
  recordsLocked: () => taint.locked,
})
// Every Settings change applies to the running race at once (src/menu/live.ts): livery, effects, volume, time and
// weather now, laps from the next restart. The URL follows each change (startUrlSync above).
let applied: Settings = settings
window.addEventListener(SETTINGS_EVENT, (e) => {
  const next = (e as CustomEvent<Settings>).detail
  const change = settingsChange(applied, next)
  applied = next
  if (change.livery) {
    const livery = clampLivery(change.livery)
    view.setLivery(livery)
    ghostCar.setLivery(ghostLivery(livery))
  }
  if (change.fx) view.setFx(change.fx)
  if (change.laps !== undefined) race.setLaps(change.laps)
  if (change.environment) {
    env = resolveEnvironment('', track, next, Date.now())
    void view.setEnvironment(env, env.seed ?? 1)
  }
})
// Begin is ignored while paused (Esc; unpause first) and while flying (Space rises there).
mountAudioControls(audio, () => race.start(), () => beginAllowed(race.paused, cam.fly !== null), settings.volume, (volume) =>
  saveSettings(localStorage, { ...loadSettings(localStorage), volume }),
)
// The card pick is the start gesture: skip the Begin overlay and go straight into the countdown.
if (fromMenu) document.getElementById('begin')?.click()
// Debug spawn for screenshots (docs/development.md § Debug screenshots): ?x&y&z&yaw places the car, freeze=1 holds it.
// With &cam=fly the same params (plus &pitch) place the free-fly camera instead, and the car stays on the grid.
const pose = debugPose(location.search)
const flyAtStart = flyRequested(location.search)
if (pose && !flyAtStart) sim.state = { ...createCarAt(pose), orientation: yawRoll(pose.heading, debugRoll(location.search)) }
const freeze = frozen(location.search)
if (freeze) document.getElementById('begin')?.remove()
// &ghost=show (debug shots): the ghost stands 4 m to the car's left in the car's pose, no best lap needed.
const ghostShow = new URLSearchParams(location.search).get('ghost') === 'show'
if (ghostShow) {
  const side = rotate(sim.state.orientation, v3(4, 0, 0))
  ghostCar.update({ ...sim.state, position: v3(sim.state.position.x + side.x, sim.state.position.y + side.y, sim.state.position.z + side.z) }, 0)
  ghostCar.object.visible = true
}
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
flying = () => cam.fly
orbiting = () => cam.orbiting
viewNow = () => cam.viewMode
// The one keydown dispatch for the shell; race keys are handled inside src/race.
window.addEventListener('keydown', (e) => {
  debug.onKeyDown(e)
  cam.onKeyDown(e)
  tuning?.onKeyDown(e)
})
;(window as unknown as { driftline: object }).driftline = { centreline: (step: number) => centreline(track, step), ready: true }
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now
  const fly = cam.fly

  const carInput = input.read()
  taint.observe(isTuned())
  if (!freeze && !fly) race.frame(elapsed, carInput)
  if (!fly) ghostRecorder.consume(sim.fed)
  if (ghost && !fly) {
    ghost.advanceTo(sim.state.tick - lapStartTick)
    ghostCar.update(ghost.render(sim.alpha), race.paused ? 0 : elapsed)
  }
  const s = sim.render()
  const material = materialUnder(s, sim.surface)
  if (!fly) audio.update(s, carInput, material, kerbs.onKerb(s.position))
  const speed = dot(s.velocity, forwardOf(s))

  view.car.visible = fly !== null || cam.viewMode !== 'cockpit'
  cam.frame(s, speed, elapsed, input.held())

  const f = cam.fly
  debug.setText(
    f
      ? `${backend}  ${track.name}  FLY${cam.orbiting ? ' ORBIT' : ''}  x ${f.position.x.toFixed(1)}  y ${f.position.y.toFixed(1)}  z ${f.position.z.toFixed(1)}  yaw ${wrapDeg((f.yaw * 180) / Math.PI).toFixed(0)}  pitch ${((f.pitch * 180) / Math.PI).toFixed(0)}  ·  WASD move  drag look  Space/Ctrl up/down (E/Q)  Shift fast  O orbit  C exit`
      : `${backend}  ${track.name}  ${environmentLabel(env)}  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}  yaw ${yawDeg(forwardOf(s)).toFixed(0)}${inLoop(s.position) ? `  up ${rotate(s.orientation, v3(0, 1, 0)).y.toFixed(2)}` : ''}${material === 'road' ? '' : `  ${material}`}${s.turbo > 0 ? '  TURBO' : ''}`,
  )
  view.start?.update(race.board())
  view.frame(s, elapsed, material, carInput.brake > 0)
})
