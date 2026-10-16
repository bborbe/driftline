// Scene look: Poly Haven HDRI sky (background + reflections), sun with car-following shadows,
// textured grass ground, Kenney Nature Kit scenery. Track and car are added by view.ts.
import * as THREE from 'three/webgpu'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import type { Track } from '../track/schema'
import hdrUrl from '/assets/sky/kloofendal_48d_partly_cloudy_puresky_1k.hdr?url'
import grassUrl from '/assets/textures/grass_diff_1k.jpg?url'
import { createScenery } from './scenery'

/** Horizon tint: fog fades distant ground into the HDRI's horizon instead of a hard edge. */
const HORIZON = 0xb9d4e8

/** The Poly Haven grass is dry and yellow; tint it toward the Kenney verge green. */
const GRASS_TINT = 0x7fc25a

/** One grass texture tile in metres. */
export const GRASS_TILE = 8

/**
 * Grass ground plane. Drawn first and without depth writes, so it can never hide the road:
 * a banked turn's inner half dips below it mid-turn (src/track/bank.ts).
 */
export const createGround = (map?: THREE.Texture): THREE.Mesh => {
  const size = 2000
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(size / GRASS_TILE, size / GRASS_TILE)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map, color: map ? GRASS_TINT : 0x5a9a48, roughness: 1, depthWrite: false }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.renderOrder = -1
  ground.receiveShadow = true
  return ground
}

export type SceneSetup = {
  scene: THREE.Scene
  /** Move the sun's shadow frustum to follow a world point (the car). */
  follow: (x: number, y: number, z: number) => void
}

export const createScene = async (track: Track): Promise<SceneSetup> => {
  const scene = new THREE.Scene()
  const [sky, grass, scenery] = await Promise.all([
    new HDRLoader().loadAsync(hdrUrl),
    new THREE.TextureLoader().loadAsync(grassUrl),
    createScenery(track),
  ])
  sky.mapping = THREE.EquirectangularReflectionMapping
  scene.background = sky
  scene.environment = sky // image-based lighting + road reflections
  scene.environmentIntensity = 0.45
  scene.fog = new THREE.Fog(HORIZON, 250, 1200)

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = 0.05 // keeps lit surfaces from self-shadowing (acne)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -60
  sc.right = sc.top = 60
  sc.near = 1
  sc.far = 200
  scene.add(sun, sun.target, createGround(grass), scenery)

  const follow = (x: number, y: number, z: number) => {
    sun.position.set(x + 40, y + 80, z + 30)
    sun.target.position.set(x, y, z)
  }
  return { scene, follow }
}
