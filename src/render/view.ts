// Scene owner: renderer (WebGPU, WebGL2 fallback), sky, lighting, ground, track and car mesh.
// main.ts calls createView() once and view.frame(state) every frame; nothing here writes car state.
import * as THREE from 'three/webgpu'
import type { CarState } from '../physics'
import type { Track } from '../track/schema'
import { createCarView } from './car/model'
import { createPieceTrack } from './track/kenney'

export type View = {
  renderer: THREE.WebGPURenderer
  camera: THREE.PerspectiveCamera
  backend: 'WebGPU' | 'WebGL2'
  /** Pose the car from physics state and draw one frame; dt in seconds. */
  frame: (state: CarState, dt: number) => void
}

const SKY = 0x8fd3ff

/**
 * Grass ground plane. Drawn first and without depth writes, so it can never hide the road:
 * a banked turn's inner half dips below it mid-turn (src/track/bank.ts).
 */
export const createGround = (): THREE.Mesh => {
  // Two-tone grass checker so motion stays readable off-track.
  const checker = new Uint8Array(2 * 2 * 4)
  checker.set([96, 168, 72, 255, 84, 150, 62, 255, 84, 150, 62, 255, 96, 168, 72, 255])
  const tex = new THREE.DataTexture(checker, 2, 2)
  tex.magFilter = THREE.NearestFilter
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(200, 200)
  tex.needsUpdate = true
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({ map: tex, depthWrite: false }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.renderOrder = -1
  ground.receiveShadow = true
  return ground
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

  scene.add(createGround(), await createPieceTrack(track))
  const car = await createCarView()
  scene.add(car.object)

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const frame = (s: CarState, dt: number) => {
    car.update(s, dt)
    // Shadow frustum follows the car.
    sun.position.set(s.position.x + 40, s.position.y + 80, s.position.z + 30)
    sun.target.position.set(s.position.x, s.position.y, s.position.z)
    renderer.render(scene, camera)
  }

  return { renderer, camera, backend, frame }
}
