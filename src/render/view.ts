// Scene owner: renderer (WebGPU, WebGL2 fallback), track and car mesh; the look lives in scene.ts.
// main.ts calls createView() once and view.frame(state) every frame; nothing here writes car state.
import * as THREE from 'three/webgpu'
import { pass } from 'three/tsl'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { dot, forwardOf, type CarState, type Material } from '../physics'
import type { Track } from '../track/schema'
import { createCarView } from './car/model'
import { parseFx } from './fx/flags'
import { createSkidMarks } from './fx/skid'
import { createDust } from './fx/dust'
import { createSmoke } from './fx/smoke'
import { createSpeedLines } from './fx/speedlines'
import { createRain } from './fx/rain'
import { FrameStats } from './fx/stats'
import { watchFullscreen } from '../fullscreen'
import { createScene } from './scene'
import { topCamFor, topCamRequested } from './topcam'
import { createPieceTrack } from './track/kenney'
import { createEdgeGlow } from './track/curbs'
import { DEFAULT_ENVIRONMENT, type Environment } from '../track/environment'

export type View = {
  renderer: THREE.WebGPURenderer
  camera: THREE.PerspectiveCamera
  backend: 'WebGPU' | 'WebGL2'
  /** The player car mesh; main.ts hides it for the in-car view. */
  car: THREE.Object3D
  /** For extra scene objects owned elsewhere (e.g. the ghost car). */
  scene: THREE.Scene
  /** Pose the car from physics state and draw one frame; dt in seconds; `material` is the surface under the car. */
  frame: (state: CarState, dt: number, material?: Material) => void
}

/** Wet asphalt: darker and glossier, so the sky and the lights mirror in it. Road materials are named `road` (mesh.ts, the Kenney pieces). */
export const WET_ROAD = { roughness: 0.22, darken: 0.7, clearcoat: 0.8, clearcoatRoughness: 0.08 } as const

const wetRoad = (root: THREE.Object3D) => {
  const done = new Set<THREE.Material>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshPhysicalMaterial
      if (done.has(m) || !std.isMeshStandardMaterial || m.name !== 'road') continue
      done.add(m)
      std.roughness = WET_ROAD.roughness
      std.color.multiplyScalar(WET_ROAD.darken)
      if (std.isMeshPhysicalMaterial) {
        std.clearcoat = WET_ROAD.clearcoat
        std.clearcoatRoughness = WET_ROAD.clearcoatRoughness
      }
    }
  })
}

/** `env` is the race's time of day and weather (track/environment.ts); `seed` varies its cloud layer. */
export const createView = async (track: Track, fxQuery: string = location.search, env: Environment = DEFAULT_ENVIRONMENT, seed = 1): Promise<View> => {
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

  const [{ scene, look, follow, frame: sky }, trackMesh, car] = await Promise.all([createScene(track, env, seed), createPieceTrack(track), createCarView()])
  renderer.toneMappingExposure = look.exposure
  scene.add(trackMesh, car.object)
  // Night lights the road edges; rain wets the road and falls around the camera (render/environment.ts).
  if (look.night) scene.add(createEdgeGlow(track))
  if (look.rain) wetRoad(trackMesh)
  const rain = look.rain ? createRain(seed) : null
  if (rain) scene.add(rain.object)

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000)
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)
  watchFullscreen(resize)

  // Effects behind ?fx=bloom,speedlines,skid,smoke; all read car state only.
  const fx = parseFx(fxQuery)
  let draw = () => renderer.render(scene, camera)
  if (fx.has('bloom')) {
    const pipeline = new THREE.RenderPipeline(renderer)
    const scenePass = pass(scene, camera)
    pipeline.outputNode = scenePass.add(bloom(scenePass, 0.3, 0.4, 0.9))
    draw = () => pipeline.render()
  }
  const speedLines = fx.has('speedlines') ? createSpeedLines() : null
  if (speedLines) {
    camera.add(speedLines.object)
    scene.add(camera) // camera children render only when the camera is in the scene
  }
  const skid = fx.has('skid') ? createSkidMarks() : null
  if (skid) scene.add(skid.object)
  const smoke = fx.has('smoke') ? createSmoke() : null
  if (smoke) scene.add(smoke.object)
  // Dust off dirt and grass is surface feedback, so it is always on.
  const dust = createDust()
  scene.add(dust.object)

  // HUD "1% low": 1st percentile of per-frame fps over the last 60 s, refreshed twice a second.
  const stats = new FrameStats()
  const fpsLabel = document.createElement('div')
  fpsLabel.id = 'fps'
  // Styled here, not in style.css, so the render module stays self-contained; matches #hud.
  fpsLabel.style.cssText =
    'position:fixed;right:8px;top:36px;padding:4px 8px;pointer-events:none;font:14px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,0.5)'
  document.body.appendChild(fpsLabel)
  let sinceLabel = 0

  const topCam = topCamRequested(location.search)
  if (topCam) scene.fog = null // the camera sits hundreds of metres up, inside the fog range

  const frame = (s: CarState, dt: number, material: Material = 'road') => {
    car.update(s, dt)
    follow(s.position.x, s.position.y, s.position.z) // shadow frustum follows the car
    speedLines?.update(dot(s.velocity, forwardOf(s)), dt)
    skid?.update(s)
    if (topCam) {
      // Debug override of the chase camera main.ts set this frame.
      const t = topCamFor(track, camera.fov, camera.aspect)
      camera.position.set(t.x, t.y, t.z)
      camera.up.set(0, 0, -1)
      camera.lookAt(t.x, 0, t.z)
    }
    smoke?.update(s, dt, camera) // after the camera override, so puffs face the final camera
    sky(camera)
    rain?.update(dt, camera)
    dust.update(s, material, dt, camera)
    draw()
    stats.push(performance.now(), dt)
    sinceLabel += dt
    if (sinceLabel >= 0.5) {
      sinceLabel = 0
      fpsLabel.textContent = stats.count === 0 ? "1% low — (warming up)" : `1% low ${stats.onePercentLow().toFixed(1)} fps · avg ${stats.average().toFixed(0)}`
    }
  }

  return { renderer, camera, backend, car: car.object, scene, frame }
}
