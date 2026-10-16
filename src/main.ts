import './style.css'
import { createCarAt, dot, FixedStepper, forwardOf, trackSurface } from './physics'
import { createChase, updateChase } from './camera/chase'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { loadLap } from './render/track/lap'
import { GameAudio, mountAudioControls } from './audio'
import { initRace } from './race'

const track = loadLap()
const view = await createView(track)
const { camera, backend } = view

const hud = document.createElement('div')
hud.id = 'hud'
document.body.appendChild(hud)

const input = new KeyboardInput()
const audio = new GameAudio()
mountAudioControls(audio)
Object.assign(window, { audio }) // dev console: audio.onCheckpoint() etc. until the lap loop calls them
const sim = new FixedStepper(createCarAt(track.start), trackSurface(track))
const race = initRace(sim, track, {
  listeners: [{ checkpoint: () => audio.onCheckpoint(), lapFinish: () => audio.onFinish(), respawn: () => audio.onRespawn() }],
})
let chase = createChase(sim.state.position, forwardOf(sim.state))
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now

  const carInput = input.read()
  race.frame(elapsed, carInput)
  const s = sim.state
  audio.update(s, carInput)
  const speed = dot(s.velocity, forwardOf(s))

  chase = updateChase(chase, s.position, forwardOf(s), Math.abs(speed), elapsed)
  camera.position.set(chase.position.x, chase.position.y, chase.position.z)
  camera.fov = chase.fov
  camera.updateProjectionMatrix()
  camera.lookAt(s.position.x, s.position.y + 0.8, s.position.z)

  hud.textContent = `${backend}  ${(Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  y ${s.position.y.toFixed(1)}  z ${s.position.z.toFixed(1)}`
  view.frame(s)
})
