import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, materialUnder, trackSurface } from './physics'
import { cockpitPose, COCKPIT_FOV, createChase, FAR_RIG, CLOSE_RIG, updateChase } from './camera/chase'
import { CAMERA_EVENT, loadView, saveView, viewForKey, type ViewMode } from './camera/views'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { LAP_NAMES, lapName, loadLap, nextLap } from './render/track/lap'
import { GameAudio, mountAudioControls } from './audio'
import { initRace } from './race'
import { createGhostCar, GhostRecorder, GhostReplayer } from './ghost'
import { mountBuildLabel } from './build-info'
import { debugPose, frozen, poseQuery, yawDeg } from './race/debug-pose'
import { centreline } from './track/centreline'
import { chooseTrack } from './menu/start'
import { skipMenu } from './menu/skip'
import { effectiveFxQuery, loadSettings, saveSettings } from './menu/settings'
import { settingsPanel } from './menu/settings-panel'

// A bare URL opens the start screen; ?track= and debug-spawn links go straight in (shared links, `make shots`).
const fromMenu = !skipMenu(location.search)
const trackName = fromMenu ? await chooseTrack(LAP_NAMES) : lapName(location.search)
const settings = loadSettings(localStorage)
const track = loadLap(trackName)
const view = await createView(track, effectiveFxQuery(location.search, settings))
const { camera, backend } = view

const hud = document.createElement('div')
hud.id = 'hud'
document.body.appendChild(hud)
mountBuildLabel()

const input = new KeyboardInput()
const audio = new GameAudio()
const sim = new FixedStepper(createCarAt(track.start), trackSurface(track))
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
      lapFinish: () => audio.onFinish(),
      respawn: () => audio.onRespawn(),
    },
    ghostRecorder.listener(() => sim.state),
    {
      // Each new lap replays the best run so far from its own start line.
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
})
// Begin is ignored while paused (Esc); unpause first.
mountAudioControls(audio, () => race.start(), () => !race.paused, settings.volume, (volume) =>
  saveSettings(localStorage, { ...loadSettings(localStorage), volume }),
)
audio.setVolume(settings.volume)
// The card pick is the start gesture: skip the Begin overlay and go straight into the countdown.
if (fromMenu) document.getElementById('begin')?.click()
// Debug spawn for screenshots (README § Debug screenshots): ?x&y&z&yaw places the car, freeze=1 holds it.
const pose = debugPose(location.search)
if (pose) sim.state = createCarAt(pose)
const freeze = frozen(location.search)
if (freeze) document.getElementById('begin')?.remove()
// P copies the current pose as a debug-spawn URL, so a visual bug can be reproduced at the exact spot.
const toast = document.createElement('div')
toast.id = 'toast'
document.body.appendChild(toast)
let toastTimer = 0
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyP' || e.repeat) return
  const s = sim.state
  const url = `${location.origin}${location.pathname}${poseQuery(lapName(location.search), s.position, yawDeg(forwardOf(s)))}`
  const show = (msg: string) => {
    toast.textContent = msg
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1500)
  }
  navigator.clipboard.writeText(url).then(
    () => show('copied spawn URL'),
    () => show(url),
  )
})
;(window as unknown as { driftline: object }).driftline = { centreline: (step: number) => centreline(track, step), ready: true }
// Camera views: 1 close chase, 2 far chase, 3 in-car; the choice survives reloads.
let viewMode = loadView(localStorage)
const rigFor = () => (viewMode === 'far' ? FAR_RIG : CLOSE_RIG)
let chase = createChase(sim.state.position, forwardOf(sim.state), rigFor())
const setView = (mode: ViewMode) => {
  viewMode = mode
  chase = createChase(sim.state.position, forwardOf(sim.state), rigFor())
}
window.addEventListener('keydown', (e) => {
  const mode = viewForKey(e.code)
  if (!mode || e.repeat || e.target instanceof HTMLInputElement) return
  saveView(localStorage, mode)
  setView(mode)
})
window.addEventListener(CAMERA_EVENT, (e) => setView((e as CustomEvent<ViewMode>).detail))
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now

  const carInput = input.read()
  if (!freeze) race.frame(elapsed, carInput)
  ghostRecorder.frame(race.loop.input(carInput), sim.state.tick)
  if (ghost) {
    ghost.advanceTo(sim.state.tick - lapStartTick)
    ghostCar.update(ghost.render(sim.alpha), race.paused ? 0 : elapsed)
  }
  const s = sim.render()
  const material = materialUnder(s, sim.surface)
  audio.update(s, carInput, material)
  const speed = dot(s.velocity, forwardOf(s))

  view.car.visible = viewMode !== 'cockpit'
  if (viewMode === 'cockpit') {
    const c = cockpitPose(s.position, s.orientation)
    camera.position.set(c.eye.x, c.eye.y, c.eye.z)
    camera.up.set(c.up.x, c.up.y, c.up.z)
    camera.fov = COCKPIT_FOV
    camera.updateProjectionMatrix()
    camera.lookAt(c.look.x, c.look.y, c.look.z)
  } else {
    chase = updateChase(chase, s.position, forwardOf(s), Math.abs(speed), elapsed, rigFor())
    camera.position.set(chase.position.x, chase.position.y, chase.position.z)
    camera.up.set(0, 1, 0)
    camera.fov = chase.fov
    camera.updateProjectionMatrix()
    camera.lookAt(s.position.x, s.position.y + 0.8, s.position.z)
  }

  hud.textContent = `${backend}  ${track.name}  ${(Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}  yaw ${yawDeg(forwardOf(s)).toFixed(0)}${material === 'road' ? '' : `  ${material}`}${s.turbo > 0 ? '  TURBO' : ''}`
  view.frame(s, elapsed)
})
