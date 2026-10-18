import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, materialUnder, TICK_HZ, trackSurface } from './physics'
import { createCameraController } from './camera/controller'
import { flyQuery, flyRequested, wrapDeg, type FlyCam } from './camera/fly'
import { CAMERA_EVENT, loadView, saveView, type ViewMode } from './camera/views'
import { mountDebugOverlay } from './debug/overlay'
import { KeyboardInput } from './input'
import { InputMix } from './gamepad'
import { mountGamepad } from './gamepad-shell'
import { createView } from './render/view'
import { effectiveCap, FrameGate, IDLE_FPS, MENU_FPS, probeable } from './render/frame-cap'
import { applyAccess, knobsFor, reducedFor, startQuality } from './render/quality-runtime'
import { mountFade, noFade, RESULTS_DIM } from './render/fade'
import { debugVisible } from './race/hud'
import { LAP_NAMES, lapName, loadLap, nextLap } from './track/registry'
import { beginAllowed, GameAudio, KerbProbe, mountAudioControls, mountUiSounds } from './audio'
import { initRace } from './race'
import { COUNTDOWN_TICKS, lapCount } from './race/lap'
import { GhostRecorder } from './ghost'
import { leaderboardConfig } from './leaderboard/client'
import { createOnline } from './leaderboard/online'
import { createRaceGhosts, startPaceLap } from './ghost/race-ghosts'
import { debugPose, debugRoll, frozen, poseQuery, yawDeg, yawRoll } from './race/debug-pose'
import { centreline } from './track/centreline'
import { loopTubes } from './track/pose'
import { rotate, v3 } from './physics/vec'
import { chooseTrack } from './menu/start'
import { runMenuScene } from './menu/scene'
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
import { layoutId } from './track/schema'
import { loadPlayerName } from './race/store'
import { challengeUrl, readChallenge, type Challenge } from './challenge/link'
import { challengeToast, challengerName, copyLink, mountChallengeBanner, showChallengeError } from './challenge/view'

// URL state (src/menu/url-state.ts): settings and the view named in the query beat the stored ones and are stored,
// so every panel shows them; from here on the address bar follows the screen, every setting, the view and the fly
// pose (replaceState, 4 Hz), so CMD+R lands on the same screen with the same setup. A race reload starts on the grid.
// The sync reads this tab's own state, never localStorage, which another tab may rewrite under it.
let shown = settingsFromUrl(location.search, loadSettings(localStorage))
let shownView: ViewMode = viewFromUrl(location.search, loadView(localStorage))
saveSettings(localStorage, shown)
saveView(localStorage, shownView)
window.addEventListener(SETTINGS_EVENT, (e) => (shown = (e as CustomEvent<Settings>).detail))
// Colour-safe and reduced effects apply on the start screen too, and follow every change made there.
applyAccess(shown)
window.addEventListener(SETTINGS_EVENT, (e) => applyAccess((e as CustomEvent<Settings>).detail))
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
// Screen fades (src/render/fade.ts): the page opens black and fades in on the menu or the first race frame; debug
// spawns and frozen shots never fade. `window.driftline.mode` tells automated checks which screen is up.
const fade = mountFade(noFade(location.search) ? 0 : 1)
// Gamepad (src/gamepad.ts): buttons press keys — menu keys until the race runs, then race keys; driving mixes below.
const pad = mountGamepad()
// The debug overlay (fps, pose) mounts after the menu; hide its parts from the first frame on a plain URL.
document.documentElement.classList.toggle('debug-off', !debugVisible(location.search))
type Mode = 'menu' | 'race' | 'results'
let mode = (): Mode => 'menu'
// `challenge`: the challenge this page races (automated checks read the challenger's name here; it is also on the PB ghost's tag, src/ghost/tags.ts).
const driftline: {
  mode: Mode
  ready: boolean
  centreline?: (step: number) => unknown
  challengeLink?: string
  challenge?: { name: string; targetMs: number; ghost: boolean }
} = {
  get mode() {
    return mode()
  },
  ready: false,
}
;(window as unknown as { driftline: object }).driftline = driftline
// Challenge link (src/challenge): ?challenge= carries the sender's target time and, when it fit, their best-lap ghost.
// A link that cannot be read says why over the start menu and is dropped from the URL, track and all.
const bootQuery = new URLSearchParams(location.search)
const challengeValue = bootQuery.get('challenge')
let challenge: Challenge | null = null
if (challengeValue !== null) {
  const read = readChallenge(challengeValue, {
    track: bootQuery.get('track'),
    laps: lapCount(location.search, loadSettings(localStorage).laps),
    layoutOf: (name) => (LAP_NAMES.includes(name) ? layoutId(loadLap(name)) : null),
  })
  if (read.ok) {
    challenge = read.challenge
    driftline.challenge = { name: challengerName(challenge), targetMs: challenge.targetMs, ghost: challenge.ghost !== null }
  }
  else {
    showChallengeError(read.reason)
    bootQuery.delete('challenge')
    bootQuery.delete('track')
    const rest = bootQuery.toString()
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
  }
}
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
// The start menu runs over the live scene of its focused track (?sel=, else the first campaign level): the view is built
// first, the menu scene (src/menu/scene.ts) circles the car on the grid, and picking that same track starts the race
// on it with no reload; picking another fades out and loads that track (?track=), as Next track does.
const menuTrack = fromMenu ? (sel && LAP_NAMES.includes(sel) ? sel : LAP_NAMES[0]) : null
const trackName = menuTrack ?? lapName(location.search)
const settings = loadSettings(localStorage)
const track = loadLap(trackName)
// The medal pace lap records in a worker from now on, through the menu and the countdown (src/ghost/race-ghosts.ts).
const paceLap = startPaceLap(track)
// Time of day and weather: ?time=&weather= override, else the track's default or (setting) a seeded random pick.
let env = resolveEnvironment(location.search, track, settings, Date.now())
const view = await createView(track, effectiveFxQuery(location.search, settings), env, env.seed ?? 1, settings.livery, knobsFor(settings), reducedFor(settings))
// Graphics quality (Low / Medium / High / Auto / Custom) and the Access options, applied live from here on, so a change
// on the 3D start menu shows at once and carries into the race; Auto probes in the race loop (quality.frame).
const quality = startQuality(view, shown)
if (fromMenu) {
  // No shader prewarm (renderer.compileAsync): measured 864 ms on crossover, over the task's 300 ms budget, so the first
  // menu frames compile as they draw, behind the opening fade.
  // Frame cap (render/frame-cap.ts): the turntable holds MENU_FPS, its settings panel IDLE_FPS, under the player's cap.
  const menuIdle = () => document.getElementById('start-settings')?.hidden === false
  const stopMenu = runMenuScene(view, track, () => effectiveCap(shown.frameCap, menuIdle() ? IDLE_FPS : MENU_FPS))
  const picking = chooseTrack(LAP_NAMES, { focus: sel ?? trackName, onFocus: (t) => (screen = { sel: t }), live: true })
  void fade.to(0)
  const picked = await picking
  document.getElementById('challenge-error')?.remove()
  await fade.to(1)
  if (picked !== trackName) {
    location.assign(`${location.pathname}${screenQuery(location.search, urlState(), { track: picked })}`)
    await new Promise(() => {}) // the page is going; nothing after this runs
  }
  stopMenu()
}
screen = { track: trackName }
const { camera, backend } = view
if (challenge) mountChallengeBanner(challenge)

// Debug overlay (pose, fps, build label) in the corners, dev only (?dev=1 / ?debug=1; backtick toggles), P copies the debug-spawn URL
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
const inputMix = new InputMix()
const kerbs = new KerbProbe(track)
const laps = lapCount(location.search, settings.laps)
const sim = new FixedStepper(createCarAt(track.start), trackSurface(track))
// Inside a loop the overlay adds the car's up.y (−1 = upside down at the apex), so a shot can show it.
const inLoop = loopTubes(track)
const ghostRecorder = new GhostRecorder()
ghostRecorder.locked = () => taint.locked
// A challenge with a ghost races the sender's lap in the PB slot, its tag named after them; otherwise the session's fastest lap.
const ghosts = await createRaceGhosts(view.scene, track, sim, ghostRecorder, ghostLivery(settings.livery), paceLap, {
  pbRun: () => challenge?.ghost ?? ghostRecorder.best,
  pbName: challenge?.ghost ? challengerName(challenge) : undefined,
})
// Online leaderboard (src/leaderboard): only when the build sets VITE_LEADERBOARD_URL; without it there is no Global tab
// and no network call. Each finished single-lap run the recorder keeps is submitted.
const leaderboard = leaderboardConfig(import.meta.env)
const online = leaderboard
  ? createOnline(leaderboard, trackName, { storage: localStorage, laps: () => race.laps, online: () => navigator.onLine })
  : null
if (online) ghostRecorder.onKeep = (run) => online.lapKept(run)
const race = initRace(sim, track, {
  online,
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
    ghosts.listener(),
    ...(online ? [online.listener()] : []),
  ],
  onPause: (paused) => void audio.setPaused(paused),
  menu: {
    backToMenu: () => leave(screenQuery(location.search, urlState(), { sel: trackName })),
    nextTrack: () => leave(screenQuery(location.search, urlState(), { track: nextLap(track.name) })),
    settings: () => settingsPanel({ onVolume: (v) => audio.setVolume(v), trackDefault: trackEnvironment(track) }),
    challenge: (runMs) => void shareChallenge(runMs),
  },
  laps,
  recordsLocked: () => taint.locked,
  // The scene dims behind the results card and clears again on Restart.
  onResults: (shown) => {
    if (!leaving) void fade.to(shown ? RESULTS_DIM : 0)
  },
})
mode = () => (race.resultsShown ? 'results' : 'race')
pad.setContext(() => (race.paused || race.resultsShown || document.getElementById('begin') ? 'menu' : 'race'))
// Results → Challenge a friend: copy a link with this run's target and, in a single-lap run, the session's fastest lap
// as the ghost (the target is then that lap's time, so ghost and target agree). The link is also on window.driftline.
async function shareChallenge(runMs: number): Promise<void> {
  const best = race.laps === 1 ? ghostRecorder.best : null
  const url = challengeUrl(`${location.origin}${location.pathname}`, {
    track: trackName,
    layout: layoutId(track),
    laps: race.laps,
    targetMs: best?.lapTimeMs ?? runMs,
    name: loadPlayerName(localStorage),
    ghost: best,
  })
  driftline.challengeLink = url
  if (await copyLink(url)) challengeToast('Challenge link copied')
  else window.prompt('Copy this challenge link:', url)
}
// Results / Esc menu → menu or next track: the card and the Esc menu fade with the scene to black, then the page loads.
let leaving = false
async function leave(query: string): Promise<void> {
  if (leaving) return
  leaving = true
  document.documentElement.classList.add('screen-leaving')
  await fade.to(1)
  location.assign(`${location.pathname}${query}`)
}
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
    ghosts.setPbLivery(ghostLivery(livery))
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
  ghosts.pbCar.update({ ...sim.state, position: v3(sim.state.position.x + side.x, sim.state.position.y + side.y, sim.state.position.z + side.z) }, 0)
  ghosts.pbCar.object.visible = true
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
  reduced: () => reducedFor(shown),
  race: () => ({
    phase: race.loop.phase,
    countdownLeft: race.loop.countdownLeft(sim.state.tick) / TICK_HZ,
    countdownTotal: COUNTDOWN_TICKS / TICK_HZ,
  }),
})
flying = () => cam.fly
orbiting = () => cam.orbiting
viewNow = () => cam.viewMode
// The tile pick is the start gesture: skip the Begin overlay and go straight into the countdown. After the camera
// controller exists — Begin's guard reads cam.fly, and clicking it earlier threw and left READY? up.
if (fromMenu) document.getElementById('begin')?.click()
// The one keydown dispatch for the shell; race keys are handled inside src/race.
window.addEventListener('keydown', (e) => {
  debug.onKeyDown(e)
  cam.onKeyDown(e)
  tuning?.onKeyDown(e)
})
driftline.centreline = (step: number) => centreline(track, step)
driftline.ready = true
let last = performance.now()
let firstFrame = true
// Frame cap (render/frame-cap.ts): a skipped callback does nothing and the next one gets the whole elapsed time, so the
// 100 Hz physics sees the same time under every cap. The Begin prompt, the Esc menu and the results card hold IDLE_FPS;
// a debug spawn (freeze=1) and the fly camera never do, so fps measurements and fly-around stay at the player's cap.
const gate = new FrameGate()
const idle = () => !freeze && cam.fly === null && (race.paused || race.resultsShown || race.loop.phase === 'ready')

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const fps = effectiveCap(shown.frameCap, idle() ? IDLE_FPS : 0)
  if (!gate.due(now, fps, document.hidden)) return
  const elapsed = (now - last) / 1000
  last = now
  const fly = cam.fly

  const carInput = inputMix.mix(input.read(), pad.input())
  taint.observe(isTuned())
  if (!freeze && !fly) race.frame(elapsed, carInput)
  if (!fly) ghostRecorder.consume(sim.fed)
  if (!ghostShow) ghosts.frame(elapsed, { paused: race.paused, hold: fly !== null || freeze, selected: shown.ghosts, laps: race.laps })
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
  if (!ghostShow) ghosts.drawTags(camera)
  if (probeable(fps)) quality.frame(elapsed)
  if (firstFrame) {
    firstFrame = false
    void fade.to(0)
  }
})
