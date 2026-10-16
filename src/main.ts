import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, trackSurface } from './physics'
import { createChase, updateChase } from './camera/chase'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { loadLap } from './render/track/lap'
import { GameAudio, mountAudioControls } from './audio'
import { initRace } from './race'
import { createGhostCar, GhostRecorder, GhostReplayer } from './ghost'

const track = loadLap()
const view = await createView(track)
const { camera, backend } = view

const hud = document.createElement('div')
hud.id = 'hud'
document.body.appendChild(hud)

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
      // Dev-only split log: the lap-2 ghost check compares these against the best lap.
      checkpoint: (tick, index) => {
        if (import.meta.env.DEV) console.info(`split: checkpoint ${index} at tick ${tick - lapStartTick}`)
      },
    },
  ],
})
mountAudioControls(audio, () => race.start())
let chase = createChase(sim.state.position, forwardOf(sim.state))
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now

  const carInput = input.read()
  race.frame(elapsed, carInput)
  ghostRecorder.frame(race.loop.input(carInput), sim.state.tick)
  if (ghost) ghostCar.update(ghost.advanceTo(sim.state.tick - lapStartTick), elapsed)
  const s = sim.state
  audio.update(s, carInput)
  const speed = dot(s.velocity, forwardOf(s))

  chase = updateChase(chase, s.position, forwardOf(s), Math.abs(speed), elapsed)
  camera.position.set(chase.position.x, chase.position.y, chase.position.z)
  camera.fov = chase.fov
  camera.updateProjectionMatrix()
  camera.lookAt(s.position.x, s.position.y + 0.8, s.position.z)

  hud.textContent = `${backend}  ${track.name}  ${(Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}`
  view.frame(s, elapsed)
})
