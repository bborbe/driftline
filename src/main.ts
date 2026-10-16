import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, materialUnder, trackSurface } from './physics'
import { createChase, updateChase } from './camera/chase'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { LAP_NAMES, lapName, loadLap, nextLap } from './render/track/lap'
import { GameAudio, mountAudioControls } from './audio'
import { initRace } from './race'
import { lapCount } from './race/lap'
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
const laps = lapCount(location.search, settings.laps)
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
      // A lap line before the last lap chimes like a checkpoint.
      lapFinish: (_t, _ms, lap) => {
        if (lap < laps) audio.onCheckpoint()
      },
      raceFinish: () => audio.onFinish(),
      respawn: () => audio.onRespawn(),
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
let chase = createChase(sim.state.position, forwardOf(sim.state))
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

  chase = updateChase(chase, s.position, forwardOf(s), Math.abs(speed), elapsed)
  camera.position.set(chase.position.x, chase.position.y, chase.position.z)
  camera.fov = chase.fov
  camera.updateProjectionMatrix()
  camera.lookAt(s.position.x, s.position.y + 0.8, s.position.z)

  hud.textContent = `${backend}  ${track.name}  ${(Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}  yaw ${yawDeg(forwardOf(s)).toFixed(0)}${material === 'road' ? '' : `  ${material}`}${s.turbo > 0 ? '  TURBO' : ''}`
  view.frame(s, elapsed)
})
