import * as THREE from 'three/webgpu'
import './style.css'
import { createCar, dot, FixedStepper, forwardOf } from './physics'
import { createChase, updateChase } from './camera/chase'
import { KeyboardInput } from './input'
import { initRace } from './race'

const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl2'

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)
await renderer.init()
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2'
console.log(`renderer: ${backend}`)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb)
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2))
const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.position.set(30, 50, 20)
scene.add(sun)

// Checkerboard ground so motion is visible.
const checker = new Uint8Array(2 * 2 * 4)
checker.set([90, 120, 60, 255, 70, 100, 45, 255, 70, 100, 45, 255, 90, 120, 60, 255])
const groundTex = new THREE.DataTexture(checker, 2, 2)
groundTex.magFilter = THREE.NearestFilter
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping
groundTex.repeat.set(200, 200)
groundTex.needsUpdate = true
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ map: groundTex }))
ground.rotation.x = -Math.PI / 2
scene.add(ground)

// Placeholder car: body + nose marker so heading is readable.
const car = new THREE.Group()
const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), new THREE.MeshStandardMaterial({ color: 0xd62828 }))
body.position.y = 0.1
car.add(body)
const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff }))
nose.position.set(0, 0.55, 1.6)
car.add(nose)
scene.add(car)

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000)
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const hud = document.createElement('div')
hud.id = 'hud'
document.body.appendChild(hud)

const input = new KeyboardInput()
const sim = new FixedStepper(createCar())
const race = initRace(scene, sim)
let chase = createChase(sim.state.position, forwardOf(sim.state))
let last = performance.now()

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now

  race.frame(elapsed, input.read())
  const s = sim.state
  const speed = dot(s.velocity, forwardOf(s))

  car.position.set(s.position.x, s.position.y, s.position.z)
  car.quaternion.set(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w)

  chase = updateChase(chase, s.position, forwardOf(s), Math.abs(speed), elapsed)
  camera.position.set(chase.position.x, chase.position.y, chase.position.z)
  camera.fov = chase.fov
  camera.updateProjectionMatrix()
  camera.lookAt(s.position.x, s.position.y + 0.8, s.position.z)

  hud.textContent = `${backend}  ${(Math.abs(speed) * 3.6).toFixed(0)} km/h  x ${s.position.x.toFixed(1)}  z ${s.position.z.toFixed(1)}`
  renderer.render(scene, camera)
})
