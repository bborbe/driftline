// Scene look: Poly Haven HDRI sky (background + reflections), sun with car-following shadows,
// textured grass ground, Kenney Nature Kit scenery, and the stadium decor (curb stripes, sign boards,
// arena backdrop: decor/). Track and car are added by view.ts. Every lever reads the track's resolved
// theme (theme.ts), whose defaults are the shared stadium look, through the race's time of day and
// weather (environment.ts): its lighting, a cloud layer, and night floodlights on the light posts.
import * as THREE from 'three/webgpu'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import type { Track } from '../track/schema'
import grassUrl from '/assets/textures/grass_diff_1k.jpg?url'
import { createScenery } from './scenery'
import { createCurbs, createEdgeLines, createMarkings } from './track/curbs'
import { createRails } from './track/rails'
import { createSigns } from './decor/signs'
import { createDressing } from './decor/dressing'
import { createStadium } from './decor/stadium'
import { flat } from './tags'
import { anisotropy } from './anisotropy'
import { resolveTheme, skyUrl, type ResolvedTheme } from './theme'
import { cloudPixels, environmentLook, type CloudLook, type EnvironmentLook } from './environment'
import { DEFAULT_ENVIRONMENT, trackEnvironment, type Environment } from '../track/environment'

/** The Poly Haven grass is dry and yellow; tint it toward the Kenney verge green (a theme's `ground` overrides it). */
const GRASS_TINT = 0x7fc25a

/** Mean sRGB colour of grass_diff_1k.jpg (0–255), measured from the file: what a tint is multiplied onto. */
export const GRASS_MEAN: readonly [number, number, number] = [113, 97, 36]

/** A theme ground this light (every sRGB channel at least this) is snow: no grass shows through it. */
const SNOW_MIN = 0xd0

export const isSnowGround = (ground: THREE.ColorRepresentation): boolean => {
  const c = new THREE.Color(ground).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  return Math.round(Math.min(c.r, c.g, c.b) * 255) >= SNOW_MIN
}

/** One grass texture tile in metres. */
export const GRASS_TILE = 8

/**
 * Grass ground plane. Drawn first and without depth writes, so it can never hide the road:
 * a banked turn's inner half dips below it mid-turn (src/track/bank.ts).
 * A snow tint drops the grass map: tint × the dry grass reads olive, not white (glacier).
 */
export const createGround = (grass?: THREE.Texture, tint: THREE.ColorRepresentation = GRASS_TINT): THREE.Mesh => {
  const size = 2000
  const map = isSnowGround(tint) ? undefined : grass
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(size / GRASS_TILE, size / GRASS_TILE)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = anisotropy()
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map, color: tint, roughness: 1, depthWrite: false }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.renderOrder = -1
  ground.receiveShadow = true
  return flat(ground, 'terrain')
}

export type SceneSetup = {
  scene: THREE.Scene
  /** The race's lighting and extras (environment.ts); view.ts adds the rain, the snow and the wet road from it. */
  look: EnvironmentLook
  /** Move the sun's shadow frustum to follow a world point (the car). */
  follow: (x: number, y: number, z: number) => void
  /** Keep camera-centred sky parts (the cloud layer) around the camera; once per frame, after it moved. */
  frame: (camera: THREE.Camera) => void
  /** Switch time of day and weather in place (Settings): sky, sun, fog, clouds and floodlights; returns the new look. */
  setEnvironment: (env: Environment, seed?: number) => Promise<EnvironmentLook>
}

/** Cloud layer: a flattened half-sphere around the camera, inside the far plane (view.ts, 3000 m) and drawn without fog. */
export const CLOUD_RADIUS = 2400
const CLOUD_FLATTEN = 0.45

export const createClouds = (c: CloudLook, seed: number): THREE.Mesh => {
  const width = 1024
  const height = 256
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.putImageData(new ImageData(cloudPixels(width, height, c.cover, seed) as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(CLOUD_RADIUS, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, color: c.color, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }),
  )
  mesh.name = 'clouds'
  mesh.scale.set(1, CLOUD_FLATTEN, 1)
  mesh.renderOrder = -2
  mesh.frustumCulled = false
  return flat(mesh, 'sky')
}

/** Soft round glow for a floodlight lamp: a radial gradient, white core to clear edge. */
const glowTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(235,242,255,0.8)')
  grad.addColorStop(1, 'rgba(200,220,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Floodlight size in metres: a lit lamp head reads from across the arena. */
export const FLOODLIGHT_SIZE = 22

/** Night: a lit glow on every light post's lamps (decor/stadium.ts `userData.floodlights`). The light itself is the sun as key light. */
export const createFloodlights = (heads: readonly THREE.Vector3[]): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'floodlights'
  const material = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf2f6ff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  for (const h of heads) {
    const sprite = new THREE.Sprite(material)
    sprite.position.copy(h)
    sprite.scale.setScalar(FLOODLIGHT_SIZE)
    group.add(sprite)
  }
  return group
}

/**
 * The static world around the track: ground, scenery, stadium, curbs, edge rails and signs. No sky, lights or
 * textures loaded here, so the geometry lint (geometry-lint.test.ts) builds exactly this, headless.
 */
export const createWorld = async (track: Track, theme: ResolvedTheme = resolveTheme(track), grass?: THREE.Texture): Promise<THREE.Group> => {
  const [scenery, stadium] = await Promise.all([createScenery(track, theme.scenery), createStadium(track, theme.screen, theme.stand)])
  const curb = theme.curb === undefined ? undefined : new THREE.Color(theme.curb)
  const world = new THREE.Group()
  world.name = 'world'
  world.add(createGround(grass, theme.ground), scenery, stadium, createCurbs(track, curb), createMarkings(track), createEdgeLines(track), createRails(track), createSigns(track, theme.sign), createDressing(track, theme.sign, theme.stand))
  return world
}

/**
 * Point the scene's lights and fog at `look` (the sky texture aside, which scene.setEnvironment loads):
 * the one place a look reaches the scene, at creation and on every live change.
 */
export const applyLighting = (scene: THREE.Scene, sun: THREE.DirectionalLight, look: EnvironmentLook): void => {
  scene.backgroundIntensity = look.skyBrightness // keeps the brighter HDRIs from clipping white (theme.ts)
  scene.environmentIntensity = look.skyLight
  // Fog fades distant ground into the sky's horizon instead of a hard edge.
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.set(look.fog)
    scene.fog.near = look.fogNear
    scene.fog.far = look.fogFar
  } else scene.fog = new THREE.Fog(look.fog, look.fogNear, look.fogFar)
  sun.color.set(look.sun)
  sun.intensity = look.sunIntensity
}

export const createScene = async (track: Track, env: Environment = DEFAULT_ENVIRONMENT, seed = 1): Promise<SceneSetup> => {
  const theme = resolveTheme(track)
  let look = environmentLook(theme, env, trackEnvironment(track))
  const scene = new THREE.Scene()
  // One HDRI per sky, loaded on first use: a live switch back to a sky already seen is instant.
  const skies = new Map<string, Promise<THREE.Texture>>()
  const skyTexture = (sky: EnvironmentLook['sky']) => {
    let t = skies.get(sky)
    if (!t) {
      t = new HDRLoader().loadAsync(skyUrl(sky)).then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping
        return tex
      })
      skies.set(sky, t)
    }
    return t
  }
  const grass = await new THREE.TextureLoader().loadAsync(grassUrl)
  const [sky, world] = await Promise.all([skyTexture(look.sky), createWorld(track, theme, grass)])
  scene.background = sky
  scene.environment = sky // image-based lighting + road reflections

  const sun = new THREE.DirectionalLight(look.sun, look.sunIntensity)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = 0.05 // keeps lit surfaces from self-shadowing (acne)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -60
  sc.right = sc.top = 60
  sc.near = 1
  sc.far = 200
  scene.add(sun, sun.target, world)
  applyLighting(scene, sun, look)
  let clouds: THREE.Mesh | null = null
  const setClouds = (c: CloudLook | null, cloudSeed: number) => {
    if (clouds) {
      scene.remove(clouds)
      ;(clouds.material as THREE.MeshBasicMaterial).map?.dispose()
      ;(clouds.material as THREE.Material).dispose()
      clouds.geometry.dispose()
    }
    clouds = c ? createClouds(c, cloudSeed) : null
    if (clouds) scene.add(clouds)
  }
  setClouds(look.clouds, seed)
  const floodlights = createFloodlights((world.getObjectByName('stadium')?.userData.floodlights as THREE.Vector3[] | undefined) ?? [])
  floodlights.visible = look.night
  scene.add(floodlights)

  let lastFollow: [number, number, number] = [0, 0, 0]
  const follow = (x: number, y: number, z: number) => {
    lastFollow = [x, y, z]
    const [ox, oy, oz] = look.sunOffset
    sun.position.set(x + ox, y + oy, z + oz)
    sun.target.position.set(x, y, z)
  }
  const frame = (camera: THREE.Camera) => {
    if (clouds) camera.getWorldPosition(clouds.position)
  }
  const setEnvironment = async (next: Environment, nextSeed = seed): Promise<EnvironmentLook> => {
    look = environmentLook(theme, next, trackEnvironment(track))
    const tex = await skyTexture(look.sky)
    scene.background = tex
    scene.environment = tex
    applyLighting(scene, sun, look)
    setClouds(look.clouds, nextSeed)
    floodlights.visible = look.night
    follow(...lastFollow)
    return look
  }
  return { scene, look, follow, frame, setEnvironment }
}
