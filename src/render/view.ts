// Scene owner: renderer (WebGPU, WebGL2 fallback), track and car mesh; the look lives in scene.ts.
// main.ts calls createView() once and view.frame(state) every frame; nothing here writes car state.
import * as THREE from 'three/webgpu'
import type { CarState } from '../physics'
import type { Track } from '../track/schema'
import { createCarView } from './car/model'
import { createScene } from './scene'
import { createPieceTrack } from './track/kenney'

export type View = {
  renderer: THREE.WebGPURenderer
  camera: THREE.PerspectiveCamera
  backend: 'WebGPU' | 'WebGL2'
  /** For extra scene objects owned elsewhere (e.g. the ghost car). */
  scene: THREE.Scene
  /** Pose the car from physics state and draw one frame; dt in seconds. */
  frame: (state: CarState, dt: number) => void
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

  const [{ scene, follow }, trackMesh, car] = await Promise.all([createScene(track), createPieceTrack(track), createCarView()])
  scene.add(trackMesh, car.object)

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const frame = (s: CarState, dt: number) => {
    car.update(s, dt)
    follow(s.position.x, s.position.y, s.position.z) // shadow frustum follows the car
    renderer.render(scene, camera)
  }

  return { renderer, camera, backend, scene, frame }
}
