// Scene look: Poly Haven HDRI sky (background + reflections), sun with car-following shadows,
// textured grass ground, Kenney Nature Kit scenery, and the stadium decor (curb stripes, sign boards,
// arena backdrop: decor/). Track and car are added by view.ts. Every lever reads the track's resolved
// theme (theme.ts), whose defaults are the shared stadium look.
import * as THREE from 'three/webgpu'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import type { Track } from '../track/schema'
import grassUrl from '/assets/textures/grass_diff_1k.jpg?url'
import { createScenery } from './scenery'
import { createCurbs } from './track/curbs'
import { createSigns } from './decor/signs'
import { createStadium } from './decor/stadium'
import { flat } from './tags'
import { resolveTheme, SKY_BRIGHTNESS, skyUrl, type ResolvedTheme } from './theme'

/** The Poly Haven grass is dry and yellow; tint it toward the Kenney verge green (a theme's `ground` overrides it). */
const GRASS_TINT = 0x7fc25a

/** One grass texture tile in metres. */
export const GRASS_TILE = 8

/**
 * Grass ground plane. Drawn first and without depth writes, so it can never hide the road:
 * a banked turn's inner half dips below it mid-turn (src/track/bank.ts).
 */
export const createGround = (map?: THREE.Texture, tint: THREE.ColorRepresentation = GRASS_TINT): THREE.Mesh => {
  const size = 2000
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(size / GRASS_TILE, size / GRASS_TILE)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map, color: map ? tint : 0x5a9a48, roughness: 1, depthWrite: false }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.renderOrder = -1
  ground.receiveShadow = true
  return flat(ground, 'terrain')
}

export type SceneSetup = {
  scene: THREE.Scene
  /** Move the sun's shadow frustum to follow a world point (the car). */
  follow: (x: number, y: number, z: number) => void
}

/**
 * The static world around the track: ground, scenery, stadium, curbs and signs. No sky, lights or
 * textures loaded here, so the geometry lint (geometry-lint.test.ts) builds exactly this, headless.
 */
export const createWorld = async (track: Track, theme: ResolvedTheme = resolveTheme(track), grass?: THREE.Texture): Promise<THREE.Group> => {
  const [scenery, stadium] = await Promise.all([createScenery(track, theme.scenery), createStadium(track, theme.screen)])
  const curb = theme.curb === undefined ? undefined : new THREE.Color(theme.curb)
  const world = new THREE.Group()
  world.name = 'world'
  world.add(createGround(grass, theme.ground), scenery, stadium, createCurbs(track, curb), createSigns(track, theme.sign))
  return world
}

export const createScene = async (track: Track): Promise<SceneSetup> => {
  const theme = resolveTheme(track)
  const scene = new THREE.Scene()
  const sky = new HDRLoader().loadAsync(skyUrl(theme.sky))
  const grass = await new THREE.TextureLoader().loadAsync(grassUrl)
  const [skyTexture, world] = await Promise.all([sky, createWorld(track, theme, grass)])
  skyTexture.mapping = THREE.EquirectangularReflectionMapping
  scene.background = skyTexture
  scene.backgroundIntensity = SKY_BRIGHTNESS[theme.sky] // keeps the brighter HDRIs from clipping white (theme.ts)
  scene.environment = skyTexture // image-based lighting + road reflections
  scene.environmentIntensity = theme.skyLight
  // Fog fades distant ground into the sky's horizon instead of a hard edge.
  scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar)

  const sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = 0.05 // keeps lit surfaces from self-shadowing (acne)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -60
  sc.right = sc.top = 60
  sc.near = 1
  sc.far = 200
  scene.add(sun, sun.target, world)

  const follow = (x: number, y: number, z: number) => {
    sun.position.set(x + 40, y + 80, z + 30)
    sun.target.position.set(x, y, z)
  }
  return { scene, follow }
}
