// Kenney Nature Kit trees and rocks beside the lap. Placement is a pure, seeded planner
// (unit-tested); createScenery() only loads the glbs and clones them into place. A track's theme
// picks the model set (src/render/theme.ts); the default is SCENERY_MODELS.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { centreline } from '../track/centreline'
import type { Track } from '../track/schema'
import { TRACK_WIDTH } from './track/geometry'
import { DEFAULT_SCENERY } from './theme'

const MODEL_URLS = import.meta.glob('/assets/nature-kit/*.glb', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>

export const SCENERY_MODELS = DEFAULT_SCENERY

export type Prop = { model: string; x: number; y: number; z: number; heading: number; scale: number }

/** Rocks and stones are scaled smaller than trees and plants. */
const isRock = (model: string) => model.startsWith('rock') || model.startsWith('stone')

/** Nothing closer than this to the centreline: half the road, the verge, and room to run wide. */
export const CLEARANCE = TRACK_WIDTH / 2 + 8

// mulberry32: tiny deterministic PRNG, so every load places the same scenery.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Props from `models` every `spacing` metres along the lap, alternating sides, 0–28 m beyond the clearance. */
export const planScenery = (track: Track, spacing = 9, seed = 7, models: readonly string[] = SCENERY_MODELS): Prop[] => {
  const rand = rng(seed)
  const line = centreline(track, 2)
  const clear = (x: number, z: number, r: number) => line.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= r * r)
  const props: Prop[] = []
  for (const [i, p] of centreline(track, spacing).entries()) {
    const side = i % 2 === 0 ? 1 : -1
    const off = CLEARANCE + 2 + rand() * 28
    // Lateral (left of heading) is (cos h, -sin h) in x/z, as in schema.ts's turn centre.
    const x = p.x + Math.cos(p.heading) * off * side
    const z = p.z - Math.sin(p.heading) * off * side
    const model = models[Math.floor(rand() * models.length)]
    const scale = isRock(model) ? 2 + rand() * 2 : 4 + rand() * 3
    const heading = rand() * Math.PI * 2
    // Other parts of the lap may pass nearby (hairpins, lap crossings): keep their clearance too.
    if (clear(x, z, CLEARANCE + scale)) props.push({ model, x, y: 0, z, heading, scale })
  }
  return props
}

export const createScenery = async (track: Track, set: readonly string[] = SCENERY_MODELS): Promise<THREE.Group> => {
  const loader = new GLTFLoader()
  const models = new Map<string, THREE.Object3D>()
  await Promise.all(
    set.map(async (m) => {
      const url = MODEL_URLS[`/assets/nature-kit/${m}.glb`]
      if (!url) throw new Error(`no asset for scenery model "${m}"`)
      const root = (await loader.loadAsync(url)).scene
      root.traverse((o) => (o.castShadow = o.receiveShadow = true))
      models.set(m, root)
    }),
  )
  const group = new THREE.Group()
  group.name = 'scenery'
  for (const p of planScenery(track, 9, 7, set)) {
    const obj = models.get(p.model)!.clone()
    obj.position.set(p.x, p.y, p.z)
    obj.rotation.y = p.heading
    obj.scale.setScalar(p.scale)
    group.add(obj)
  }
  return group
}
