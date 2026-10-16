// Scene owner: renderer (WebGPU, WebGL2 fallback), sky, lighting, ground, track and car mesh.
// main.ts calls createView() once and view.frame(state) every frame; nothing here writes car state.
import * as THREE from 'three/webgpu'
import type { CarState } from '../physics'
import type { Track } from '../track/schema'
import { createTrackMesh } from './track/mesh'

export type View = {
  renderer: THREE.WebGPURenderer
  camera: THREE.PerspectiveCamera
  backend: 'WebGPU' | 'WebGL2'
  /** Pose the car from physics state and draw one frame. */
  frame: (state: CarState) => void
}

const SKY = 0x8fd3ff

const createGround = (): THREE.Mesh => {
  // Two-tone grass checker so motion stays readable off-track.
  const checker = new Uint8Array(2 * 2 * 4)
  checker.set([96, 168, 72, 255, 84, 150, 62, 255, 84, 150, 62, 255, 96, 168, 72, 255])
  const tex = new THREE.DataTexture(checker, 2, 2)
  tex.magFilter = THREE.NearestFilter
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(200, 200)
  tex.needsUpdate = true
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ map: tex }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  return ground
}

const createCarMesh = (): THREE.Group => {
  // Placeholder car: body + nose marker so heading is readable.
  const car = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xd62828, clearcoat: 1, roughness: 0.3 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), paint)
  body.position.y = 0.1
  car.add(body)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff }))
  nose.position.set(0, 0.55, 1.6)
  car.add(nose)
  car.traverse((o) => (o.castShadow = true))
  return car
}

export const createView = async (track: Track): Promise<View> => {
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl2'
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  document.body.appendChild(renderer.domElement)
  await renderer.init()
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2'
  console.log(`renderer: ${backend}`)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)
  scene.fog = new THREE.Fog(SKY, 250, 1200)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a7a3a, 1.4))

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -60
  sc.right = sc.top = 60
  sc.near = 1
  sc.far = 200
  scene.add(sun, sun.target)

  scene.add(createGround(), createTrackMesh(track))
  const car = createCarMesh()
  scene.add(car)

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const frame = (s: CarState) => {
    car.position.set(s.position.x, s.position.y, s.position.z)
    car.quaternion.set(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w)
    // Shadow frustum follows the car.
    sun.position.set(s.position.x + 40, s.position.y + 80, s.position.z + 30)
    sun.target.position.set(s.position.x, s.position.y, s.position.z)
    renderer.render(scene, camera)
  }

  return { renderer, camera, backend, frame }
}
