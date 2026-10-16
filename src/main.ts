import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, materialUnder, trackSurface } from './physics'
import { cockpitPose, COCKPIT_FOV, createChase, FAR_RIG, CLOSE_RIG, updateChase } from './camera/chase'
import { CAMERA_EVENT, loadView, saveView, viewForKey, type ViewMode } from './camera/views'
import {
  createFly,
  flyInputFrom,
  flyLooking,
  flyQuery,
  flyRequested,
  flyToggleKey,
  FLY_FOV,
  look,
  lookDir,
  ORBIT_RATE,
  orbitAngleNear,
  orbitFor,
  orbitPose,
  orbitRequested,
  orbitToggleKey,
  pitchParam,
  updateFly,
  wrapDeg,
  type FlyCam,
} from './camera/fly'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { LAP_NAMES, lapName, loadLap, nextLap } from './render/track/lap'
import { GameAudio, mountAudioControls } from './audio'
import { initRace } from './race'
import { lapCount } from './race/lap'
import { createGhostCar, GhostRecorder, GhostReplayer } from './ghost'
import { mountBuildLabel } from './build-info'
import { debugPose, frozen, poseQuery, yawDeg } from './race/debug-pose'
import { add, v3 } from './physics/vec'
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
// Begin is ignored while paused (Esc); unpause first.
mountAudioControls(audio, () => race.start(), () => !race.paused, settings.volume, (volume) =>
  saveSettings(localStorage, { ...loadSettings(localStorage), volume }),
)
audio.setVolume(settings.volume)
// The card pick is the start gesture: skip the Begin overlay and go straight into the countdown.
if (fromMenu) document.getElementById('begin')?.click()
// Debug spawn for screenshots (README § Debug screenshots): ?x&y&z&yaw places the car, freeze=1 holds it.
// With &cam=fly the same params (plus &pitch) place the free-fly camera instead, and the car stays on the grid.
const pose = debugPose(location.search)
const flyAtStart = flyRequested(location.search)
if (pose && !flyAtStart) sim.state = createCarAt(pose)
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
  const query = fly ? flyQuery(lapName(location.search), fly) : poseQuery(lapName(location.search), s.position, yawDeg(forwardOf(s)))
  const url = `${location.origin}${location.pathname}${query}`
  const show = (msg: string) => {
    toast.textContent = msg
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1500)
  }
  navigator.clipboard.writeText(url).then(
    () => show(fly ? 'copied fly view URL' : 'copied spawn URL'),
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
  leaveFly()
})
window.addEventListener(CAMERA_EVENT, (e) => setView((e as CustomEvent<ViewMode>).detail))
// Free-fly camera (C, or ?cam=fly): the race, ghost and audio hold still while flying; C again (or 1/2/3)
// returns to the chase/in-car view and the race carries on from the same tick. O orbits the whole track.
let fly: FlyCam | null = null
let orbitAngle: number | null = null
const orbit = orbitFor(track)
const enterFly = (cam: FlyCam) => {
  fly = cam
  void audio.setPaused(true)
}
function leaveFly() {
  if (!fly) return
  fly = null
  orbitAngle = null
  void audio.setPaused(race.paused)
  chase = createChase(sim.state.position, forwardOf(sim.state), rigFor())
}
const flyFromCamera = (): FlyCam => {
  const dir = camera.getWorldDirection(camera.position.clone())
  const eye = v3(camera.position.x, camera.position.y, camera.position.z)
  return flyLooking(eye, add(eye, v3(dir.x, dir.y, dir.z)))
}
const toggleOrbit = () => {
  if (orbitAngle !== null) {
    orbitAngle = null
    return
  }
  if (!fly) enterFly(flyFromCamera())
  orbitAngle = orbitAngleNear(orbit, fly!.position)
}
if (flyAtStart) {
  const car = sim.state.position
  enterFly(
    pose
      ? createFly(v3(pose.x, pose.y, pose.z), pose.heading, pitchParam(location.search))
      : flyLooking(chase.position, v3(car.x, car.y + 0.8, car.z)),
  )
  if (orbitRequested(location.search)) toggleOrbit()
}
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.target instanceof HTMLInputElement) return
  if (flyToggleKey(e.code)) {
    if (fly) leaveFly()
    else enterFly(flyFromCamera())
  } else if (orbitToggleKey(e.code)) toggleOrbit()
})
// Mouse drag looks around while flying (and ends an orbit where it is).
let dragging = false
view.renderer.domElement.addEventListener('mousedown', (e) => {
  if (fly && e.button === 0) dragging = true
})
window.addEventListener('mouseup', () => (dragging = false))
window.addEventListener('mousemove', (e) => {
  if (!dragging || !fly) return
  orbitAngle = null
  fly = look(fly, e.movementX, e.movementY)
})
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now

  const carInput = input.read()
  if (!freeze && !fly) race.frame(elapsed, carInput)
  if (!fly) ghostRecorder.frame(race.loop.input(carInput), sim.state.tick)
  if (ghost && !fly) {
    ghost.advanceTo(sim.state.tick - lapStartTick)
    ghostCar.update(ghost.render(sim.alpha), race.paused ? 0 : elapsed)
  }
  const s = sim.render()
  const material = materialUnder(s, sim.surface)
  if (!fly) audio.update(s, carInput, material)
  const speed = dot(s.velocity, forwardOf(s))

  view.car.visible = fly !== null || viewMode !== 'cockpit'
  if (fly) {
    const flyInput = flyInputFrom(input.held())
    if (orbitAngle !== null && (flyInput.forward || flyInput.right || flyInput.up)) orbitAngle = null
    if (orbitAngle !== null) {
      orbitAngle += ORBIT_RATE * elapsed
      fly = orbitPose(orbit, orbitAngle)
    } else fly = updateFly(fly, flyInput, Math.min(elapsed, 0.1))
    const p = fly.position
    const d = lookDir(fly.yaw, fly.pitch)
    camera.position.set(p.x, p.y, p.z)
    camera.up.set(0, 1, 0)
    camera.fov = FLY_FOV
    camera.updateProjectionMatrix()
    camera.lookAt(p.x + d.x, p.y + d.y, p.z + d.z)
  } else if (viewMode === 'cockpit') {
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

  hud.textContent = fly
    ? `${backend}  ${track.name}  FLY${orbitAngle !== null ? ' ORBIT' : ''}  x ${fly.position.x.toFixed(1)}  y ${fly.position.y.toFixed(1)}  z ${fly.position.z.toFixed(1)}  yaw ${wrapDeg((fly.yaw * 180) / Math.PI).toFixed(0)}  pitch ${((fly.pitch * 180) / Math.PI).toFixed(0)}  ·  WASD move  drag look  E/Q up/down  Shift fast  O orbit  C exit`
    : `${backend}  ${track.name}  ${race.loop.phase === 'finished' ? 0 : (Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}  yaw ${yawDeg(forwardOf(s)).toFixed(0)}${material === 'road' ? '' : `  ${material}`}${s.turbo > 0 ? '  TURBO' : ''}`
  view.frame(s, elapsed, material)
})
