import './style.css'
import { createCar, dot, FixedStepper, forwardOf } from './physics'
import { createChase, updateChase } from './camera/chase'
import { KeyboardInput } from './input'
import { createView } from './render/view'
import { FIXTURE_TRACK } from './render/track/fixture'

const view = await createView(FIXTURE_TRACK)
const { camera, backend } = view

const hud = document.createElement('div')
hud.id = 'hud'
document.body.appendChild(hud)

const input = new KeyboardInput()
const sim = new FixedStepper(createCar())
let chase = createChase(sim.state.position, forwardOf(sim.state))
let last = performance.now()

view.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now

  sim.advance(elapsed, input.read())
  const s = sim.state
  const speed = dot(s.velocity, forwardOf(s))

  chase = updateChase(chase, s.position, forwardOf(s), Math.abs(speed), elapsed)
  camera.position.set(chase.position.x, chase.position.y, chase.position.z)
  camera.fov = chase.fov
  camera.updateProjectionMatrix()
  camera.lookAt(s.position.x, s.position.y + 0.8, s.position.z)

  hud.textContent = `${backend}  ${(Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  z ${s.position.z.toFixed(1)}`
  view.frame(s)
})
