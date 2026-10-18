// Scene owner: renderer (WebGPU, WebGL2 fallback), track and car mesh; the look lives in scene.ts.
// main.ts calls createView() once and view.frame(state) every frame; nothing here writes car state.
import * as THREE from 'three/webgpu'
import { builtinAOContext, mrt, normalView, pass, renderOutput, saturation, screenUV, uniform, vec4 } from 'three/tsl'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js'
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { dot, forwardOf, trackSurface, type CarState, type Material } from '../physics'
import type { Track } from '../track/schema'
import { createCarView } from './car/model'
import { createContactShadow } from './car/contact-shadow'
import { setMaxAnisotropy } from './anisotropy'
import { gradeFor } from './grade'
import { aoRequested, postPasses } from './post'
import type { Livery } from './car/livery'
import { parseFx, type Fx } from './fx/flags'
import { BLOOM, bloomFor, glowPreset } from './glow'
import { createNeon, markReflectable, setNeonGlow } from './neon'
import { createSkidMarks } from './fx/skid'
import { createDust } from './fx/dust'
import { createSparks } from './fx/sparks'
import { createDriftGlow } from './fx/drift-cue'
import { createSmoke } from './fx/smoke'
import { createBoostStreaks } from './fx/boost-streaks'
import { createSpeedLines } from './fx/speedlines'
import { createRain, RAIN_DROPS } from './fx/rain'
import { createSnow, SNOW_FLAKES } from './fx/snow'
import { qualityKnobs, type Knobs } from './quality'
import { FrameStats } from './fx/stats'
import { watchFullscreen } from '../fullscreen'
import { createScene } from './scene'
import { topCamFor, topCamRequested } from './topcam'
import { createPieceTrack } from './track/kenney'
import { DEFAULT_ENVIRONMENT, type Environment } from '../track/environment'
import { createStartDressing, type StartDressing } from './track/start-dressing'

export type View = {
  renderer: THREE.WebGPURenderer
  camera: THREE.PerspectiveCamera
  backend: 'WebGPU' | 'WebGL2'
  /** The player car mesh; main.ts hides it for the in-car view. */
  car: THREE.Object3D
  /** Repaint the player car (Settings → Livery). */
  setLivery: (l: Livery) => void
  /** Switch time of day and weather in place (Settings → Time / Weather): sky, light, fog, clouds, floodlights, rain, snow, wet road, bloom. */
  setEnvironment: (env: Environment, seed?: number) => Promise<void>
  /** Turn the live effects (fx/flags.ts LIVE_FX) on or off (Settings → Effect). */
  setFx: (fx: Set<Fx>) => void
  /**
   * Apply the graphics-quality knobs (render/quality.ts) live: pixel ratio, sun shadows, the post pipeline,
   * Neon Night's road reflection, FXAA and the particle budget. Post and FXAA are no-ops while `?bloom=0` leaves no pipeline.
   */
  setKnobs: (k: Knobs) => void
  /** Reduced effects (Settings → Access): hides speed lines and boost streaks. */
  setReduced: (on: boolean) => void
  /** For extra scene objects owned elsewhere (e.g. the ghost car). */
  scene: THREE.Scene
  /** Start lights, arch screens and start road paint; main.ts feeds it race.board() each frame. Null without a start gate. */
  start: StartDressing | null
  /** Pose the car from physics state and draw one frame; dt in seconds; `material` is the surface under the car; `braking` lights the tail lights. */
  frame: (state: CarState, dt: number, material?: Material, braking?: boolean) => void
}

/** Wet asphalt: darker and glossier, so the sky and the lights mirror in it. Road materials are named `road` (mesh.ts, the Kenney pieces). */
export const WET_ROAD = { roughness: 0.22, darken: 0.7, clearcoat: 0.8, clearcoatRoughness: 0.08 } as const

/** Chassis origin above the road at rest (fx/skid.ts): where the reflection plane goes when the ray finds no road. */
const RIDE_HEIGHT = 0.68

type DryRoad = { roughness: number; color: THREE.Color; clearcoat: number; clearcoatRoughness: number }

/**
 * Wet or dry every road material under `root`. The dry values are kept on the material
 * (userData.dryRoad) the first time it is wetted, so a live switch back to dry restores them exactly.
 */
export const setWetRoad = (root: THREE.Object3D, wet: boolean): void => {
  const done = new Set<THREE.Material>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshPhysicalMaterial
      if (done.has(m) || !std.isMeshStandardMaterial || m.name !== 'road') continue
      done.add(m)
      const dry = (std.userData.dryRoad ??= {
        roughness: std.roughness,
        color: std.color.clone(),
        clearcoat: std.clearcoat ?? 0,
        clearcoatRoughness: std.clearcoatRoughness ?? 0,
      }) as DryRoad
      std.roughness = wet ? WET_ROAD.roughness : dry.roughness
      std.color.copy(dry.color)
      if (wet) std.color.multiplyScalar(WET_ROAD.darken)
      if (std.isMeshPhysicalMaterial) {
        std.clearcoat = wet ? WET_ROAD.clearcoat : dry.clearcoat
        std.clearcoatRoughness = wet ? WET_ROAD.clearcoatRoughness : dry.clearcoatRoughness
      }
    }
  })
}

export { NEON_GRADE } from './grade'

/** Linear mid grey: the pivot the grade's contrast curve turns around. */
const MID_GREY = 0.18

/** Soft-edged sun shadows: a hard PCF edge reads as a cut-out pasted on the ground. */
export const SHADOW_MAP_TYPE = THREE.PCFSoftShadowMap

/**
 * `env` is the race's time of day and weather (track/environment.ts); `seed` varies its cloud layer; `livery`
 * paints the player car; `knobs` are the graphics-quality knobs (render/quality.ts); `reduced` is Settings → Access → Reduced effects.
 */
export const createView = async (
  track: Track,
  fxQuery: string = location.search,
  env: Environment = DEFAULT_ENVIRONMENT,
  seed = 1,
  livery?: Livery,
  knobs: Knobs = qualityKnobs('high'),
  reduced = false,
): Promise<View> => {
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl2'
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, knobs.pixelRatio))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = SHADOW_MAP_TYPE
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  document.body.appendChild(renderer.domElement)
  await renderer.init()
  setMaxAnisotropy(renderer.getMaxAnisotropy()) // before any texture is built (anisotropy.ts)
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2'
  console.log(`renderer: ${backend}`)

  const [{ scene, look, follow, frame: sky, setEnvironment: setSceneEnvironment, setShadows }, trackMesh, car] = await Promise.all([
    createScene(track, env, seed),
    createPieceTrack(track),
    createCarView(undefined, livery),
  ])
  renderer.toneMappingExposure = look.exposure
  scene.add(trackMesh, car.object)
  const contact = createContactShadow()
  scene.add(contact.object)
  // Neon Night (neon/): tubes, skyline, sparks, pink rims and the road reflection, switched live with the time of day.
  // Every glowing mesh already in the scene (edge lines, rail neon, car lights and rims) joins the mirror pass.
  const neon = createNeon(track, trackMesh)
  scene.add(neon.object, neon.reflectionTarget)
  markReflectable(scene)
  neon.setReflections(knobs.reflections)
  neon.setActive(look.neon)
  setNeonGlow(scene, look.neon)
  // Rain wets the road and falls around the camera, snow drifts around it (render/environment.ts); all switch live with
  // the weather. Neon Night wets it too: the dark, glossy asphalt is what the reflection lands on.
  setWetRoad(trackMesh, look.rain || look.neon)
  const rain = createRain(seed)
  rain.object.visible = look.rain
  const snow = createSnow(seed)
  snow.object.visible = look.snow
  scene.add(rain.object, snow.object)
  const start = createStartDressing(track)
  if (start) scene.add(start.object)

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000)
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)
  watchFullscreen(resize)

  // Effects behind ?fx=speedlines,smoke; all read car state only. Bloom (the glow pass, glow.ts) is
  // on by default: ?bloom=0 turns it off; a night environment picks the stronger night preset.
  // Speed lines and smoke are built always and switched by visibility, so Settings toggles them live.
  let fx = parseFx(fxQuery)
  const plain = () => renderer.render(scene, camera)
  let post: (() => void) | null = null
  // The one post pipeline (post.ts): scene → [ao] → bloom → grade → [aa]. The grade's uniforms follow the look live.
  const glow = bloomFor(location.search, glowPreset(look))
  let bloomPass: ReturnType<typeof bloom> | null = null
  const g = gradeFor(look)
  const tint = uniform(new THREE.Vector3(...g.tint))
  const sat = uniform(g.saturation)
  const contrast = uniform(g.contrast)
  let setAA = (_on: boolean) => {}
  if (glow) {
    const passes = postPasses({ bloom: true, ao: aoRequested(location.search), aa: true })
    const pipeline = new THREE.RenderPipeline(renderer)
    pipeline.outputColorTransform = false // tone mapping happens after the grade, so FXAA gets display colour (post.ts)
    const scenePass = pass(scene, camera)
    if (passes.includes('ao')) {
      const prePass = pass(scene, camera, { samples: 0 }) // GTAO gathers depth texels: a multisampled depth texture cannot be read
      prePass.setMRT(mrt({ output: normalView }))
      const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera)
      aoPass.resolutionScale = 0.5
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r)
    }
    bloomPass = bloom(scenePass, glow.strength, glow.radius, glow.threshold)
    // Grade in linear light before tone mapping: contrast is a power curve around mid grey, so ACES still rolls the highlights off.
    const hdr = saturation(scenePass.add(bloomPass).rgb.mul(tint), sat).max(0)
    const contrasted = hdr.div(MID_GREY).pow(contrast).mul(MID_GREY)
    const graded = renderOutput(vec4(contrasted, 1))
    const antialiased = fxaa(graded)
    setAA = (on: boolean) => {
      pipeline.outputNode = on ? antialiased : graded
      pipeline.needsUpdate = true
    }
    setAA(knobs.aa)
    post = () => pipeline.render()
  }
  const speedLines = createSpeedLines()
  camera.add(speedLines.object)
  scene.add(camera) // camera children render only when the camera is in the scene
  // Skid marks are road detail, so they are always on (`?fx=skid` still parses, for old links); they sit on the track's own surface.
  const surface = trackSurface(track)
  const skid = createSkidMarks(surface)
  scene.add(skid.object)
  const smoke = createSmoke()
  scene.add(smoke.object)
  // Boost streaks are turbo feedback, so they are on unless reduced effects hides them (camera space, like speed lines).
  const boost = createBoostStreaks()
  camera.add(boost.object)
  let reducedOn = reduced
  const showFx = () => {
    speedLines.object.visible = fx.has('speedlines') && !reducedOn
    smoke.object.visible = fx.has('smoke')
    boost.object.visible = !reducedOn
  }
  const setFx = (next: Set<Fx>) => {
    fx = next
    showFx()
  }
  setFx(fx)
  const setReduced = (on: boolean) => {
    reducedOn = on
    showFx()
  }
  // Dust off dirt and grass is surface feedback, so it is always on.
  const dust = createDust()
  scene.add(dust.object)
  // Sparks off barrier, rail and pillar contact, and the good-drift glow under the car: contact and drift feedback, always on.
  const sparks = createSparks(surface.obstacles)
  scene.add(sparks.object)
  const driftGlow = createDriftGlow()
  scene.add(driftGlow.object)

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

  // Live time-of-day / weather switch. Requests can overlap (the HDRI loads async); only the latest applies.
  let envRequest = 0
  const setEnvironment = async (next: Environment, nextSeed = seed) => {
    const id = ++envRequest
    const l = await setSceneEnvironment(next, nextSeed)
    if (id !== envRequest) return
    if (topCam) scene.fog = null
    renderer.toneMappingExposure = l.exposure
    setWetRoad(trackMesh, l.rain || l.neon)
    rain.object.visible = l.rain
    snow.object.visible = l.snow
    neon.setActive(l.neon)
    setNeonGlow(scene, l.neon)
    const lg = gradeFor(l)
    tint.value.set(...lg.tint)
    sat.value = lg.saturation
    contrast.value = lg.contrast
    if (bloomPass) {
      const b = BLOOM[glowPreset(l)]
      bloomPass.strength.value = b.strength
      bloomPass.radius.value = b.radius
      bloomPass.threshold.value = b.threshold
    }
  }

  let usePost = true
  const setKnobs = (k: Knobs) => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, k.pixelRatio))
    renderer.shadowMap.enabled = k.shadows > 0
    setShadows(k.shadows)
    usePost = k.post
    neon.setReflections(k.reflections)
    setAA(k.aa)
    smoke.pool.scale = k.particles
    dust.pool.scale = k.particles
    rain.object.count = Math.round(RAIN_DROPS * k.particles)
    snow.object.count = Math.round(SNOW_FLAKES * k.particles)
  }
  setKnobs(knobs)

  let elapsed = 0
  const down = { x: 0, y: -1, z: 0 }
  const rayDown = new THREE.Vector3()
  const frame = (s: CarState, dt: number, material: Material = 'road', braking = false) => {
    elapsed += dt
    car.update(s, dt, braking)
    // The road under the car along its own down axis (banks, loops, wallrides): how far the body has lifted off it.
    const bodyDown = rayDown.set(0, -1, 0).applyQuaternion(car.object.quaternion)
    const under = surface.raycast(s.position, bodyDown, 50)
    contact.update(car.object, under ? under.distance : null)
    follow(s.position.x, s.position.y, s.position.z) // shadow frustum follows the car
    if (speedLines.object.visible) speedLines.update(dot(s.velocity, forwardOf(s)), dt)
    if (boost.object.visible) boost.update(s.turbo, s.turboForce, dt)
    skid.update(s)
    if (topCam) {
      // Debug override of the chase camera main.ts set this frame.
      const t = topCamFor(track, camera.fov, camera.aspect)
      camera.position.set(t.x, t.y, t.z)
      camera.up.set(0, 0, -1)
      camera.lookAt(t.x, 0, t.z)
    }
    if (fx.has('smoke')) smoke.update(s, dt, camera) // after the camera override, so puffs face the final camera
    sky(camera)
    if (rain.object.visible) rain.update(dt, camera)
    if (snow.object.visible) snow.update(dt, camera)
    dust.update(s, material, dt, camera)
    sparks.update(s, dt)
    driftGlow.update(s, dt, car.object)
    if (neon.object.visible) {
      // The mirror plane sits on the road under the car (the ray the physics drives on), or a ride height below it.
      const hit = surface.raycast(s.position, down, 50)
      neon.update(elapsed, camera, hit ? s.position.y - hit.distance : s.position.y - RIDE_HEIGHT)
    }
    ;(usePost && post ? post : plain)()
    stats.push(performance.now(), dt)
    sinceLabel += dt
    if (sinceLabel >= 0.5) {
      sinceLabel = 0
      fpsLabel.textContent = stats.count === 0 ? "1% low — (warming up)" : `1% low ${stats.onePercentLow().toFixed(1)} fps · avg ${stats.average().toFixed(0)}`
    }
  }

  return { renderer, camera, backend, car: car.object, setLivery: car.setLivery, setEnvironment, setFx, setKnobs, setReduced, scene, start, frame }
}
