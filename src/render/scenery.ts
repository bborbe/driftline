// Kenney Nature Kit trees and rocks, plus code-generated trees and buildings (decor/variants.ts),
// beside the lap. Placement is a pure, seeded planner (unit-tested); createScenery() only loads the
// glbs, builds the generated models and clones them into place. A track's theme
// picks the model set (src/render/theme.ts); the default is SCENERY_MODELS.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { centreline } from '../track/centreline'
import { capOpenEdges } from './cap'
import { onPad, type Track } from '../track/schema'
import { TRACK_WIDTH } from './track/geometry'
import { DEFAULT_SCENERY } from './theme'
import { createGenModel, GEN_BUILDINGS, GEN_RADIUS, GEN_TREES, isGen } from './decor/variants'
import { bakeModel, merged, placement } from './decor/instance'

const MODEL_URLS = import.meta.glob('/assets/nature-kit/*.glb', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>

export const SCENERY_MODELS = DEFAULT_SCENERY

export type Prop = { model: string; x: number; y: number; z: number; heading: number; scale: number; at: number }

/** Kit models shipped with open holes (tree_pineRoundC's foliage cones are open underneath): capped on load. */
export const OPEN_MODELS: readonly string[] = ['tree_pineRoundC']

/** Rocks and stones are scaled smaller than trees and plants. */
const isRock = (model: string) => model.startsWith('rock') || model.startsWith('stone')

/** Nothing closer than this to the centreline of a default-width road: half the road, the verge, and room to run wide (clearanceAt for any width). */
export const CLEARANCE = TRACK_WIDTH / 2 + 8
const clearanceAt = (width: number): number => width / 2 + 8

// mulberry32: tiny deterministic PRNG, so every load places the same scenery.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** A free spot is this far past the road for a building (its front faces the road). */
const BUILDING_OFFSET = { min: 22, spread: 14 }
/** Metres between buildings along the lap, before the 0.5×–1.7× spread. */
const BUILDING_SPACING = 80

/**
 * Props from `models` along the lap at irregular intervals (0.3×–1.8× `spacing`, the odd tight
 * cluster), either side, 0–28 m beyond the clearance; generated buildings further out every ~80 m.
 * Each prop carries `at`, the lap distance it was planned from. Nothing lands on a `keepClear`
 * footprint (x, z, r): the trackside dressing (decor/trackside-plan.ts footprints()).
 */
export const planScenery = (
  track: Track,
  spacing = 9,
  seed = 7,
  models: readonly string[] = SCENERY_MODELS,
  keepClear: readonly [number, number, number][] = [],
): Prop[] => {
  const rand = rng(seed)
  const line = centreline(track, 1)
  const clear = (x: number, z: number, extra: number) =>
    line.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= (clearanceAt(p.width) + extra) ** 2) &&
    keepClear.every(([kx, kz, kr]) => (kx - x) ** 2 + (kz - z) ** 2 >= (kr + extra) ** 2)
  const props: Prop[] = []
  const place = (at: number, model: string, off: number, side: number, scale: number, heading: (h: number, side: number) => number, radius: number) => {
    const p = line[Math.floor(at) % line.length]
    // Lateral (left of heading) is (cos h, -sin h) in x/z, as in schema.ts's turn centre.
    const x = p.x + Math.cos(p.heading) * off * side
    const z = p.z - Math.sin(p.heading) * off * side
    // Nothing on a free-drive pad or its walls: the asphalt stays open.
    if (track.pad && onPad(track.pad, x, z, -(radius + 2))) return undefined
    // Other parts of the lap may pass nearby (hairpins, lap crossings): keep their clearance too.
    if (!clear(x, z, radius)) return undefined
    const prop = { model, x, y: 0, z, heading: heading(p.heading, side), scale, at }
    props.push(prop)
    return prop
  }
  // Models come off a shuffled deck, reshuffled when empty: every variant shows within each run of len(models) props.
  let deck: string[] = []
  const draw = (): string => {
    if (deck.length === 0) {
      deck = [...models]
      for (let k = deck.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1))
        ;[deck[k], deck[j]] = [deck[j], deck[k]]
      }
    }
    return deck.pop()!
  }
  for (let at = rand() * spacing; at < line.length; ) {
    const p = line[Math.floor(at)]
    const side = rand() < 0.5 ? 1 : -1
    const off = clearanceAt(p.width) + 2 + rand() * 28
    const model = draw()
    const gen = isGen(model)
    const scale = gen ? 0.8 + rand() * 0.5 : isRock(model) ? 2 + rand() * 2 : 4 + rand() * 3
    const spin = rand() * Math.PI * 2
    // A model whose spot was blocked goes back on top of the deck and tries the next spot.
    if (!place(at, model, off, side, scale, () => spin, gen ? GEN_RADIUS[model] * scale : scale)) deck.push(model)
    // One gap in five is a tight cluster; the rest spread from 0.3× to 1.8× the spacing.
    at += rand() < 0.2 ? spacing * (0.15 + rand() * 0.2) : spacing * (0.3 + rand() * 1.5)
  }
  // Buildings take the variants in turn, so even a short lap shows each of them.
  let next = Math.floor(rand() * GEN_BUILDINGS.length)
  for (let at = rand() * BUILDING_SPACING * 0.5; at < line.length; at += BUILDING_SPACING * (0.5 + rand() * 1.2)) {
    const p = line[Math.floor(at)]
    const model = GEN_BUILDINGS[next % GEN_BUILDINGS.length]
    const scale = 0.9 + rand() * 0.25
    const radius = GEN_RADIUS[model] * scale
    const off = clearanceAt(p.width) + BUILDING_OFFSET.min + radius + rand() * BUILDING_OFFSET.spread
    const side = rand() < 0.5 ? 1 : -1
    // Front (+z) toward the road: from the right side (side -1) that is the lateral, from the left its reverse.
    const facing = (h: number, sd: number) => Math.atan2(-sd * Math.cos(h), sd * Math.sin(h))
    // Compact laps fold back on themselves: try the other side, then closer in, before giving the slot up.
    const tries: [number, number][] = [[off, side], [off, -side], [off * 0.55, side], [off * 0.55, -side]]
    if (tries.some(([o, sd]) => place(at, model, Math.max(o, clearanceAt(p.width) + radius + 4), sd, scale, facing, radius))) next++
  }
  return props.sort((a, b) => a.at - b.at)
}

/** A theme on the default model set also gets the generated trees; every theme gets the buildings. */
export const sceneryModels = (set: readonly string[]): readonly string[] => (set === SCENERY_MODELS ? [...set, ...GEN_TREES] : set)

export const createScenery = async (
  track: Track,
  set: readonly string[] = SCENERY_MODELS,
  keepClear: readonly [number, number, number][] = [],
): Promise<THREE.Group> => {
  const loader = new GLTFLoader()
  const all = sceneryModels(set)
  const models = new Map<string, THREE.Object3D>()
  for (const m of [...all.filter(isGen), ...GEN_BUILDINGS]) models.set(m, createGenModel(m))
  await Promise.all(
    all
      .filter((m) => !isGen(m))
      .map(async (m) => {
        const url = MODEL_URLS[`/assets/nature-kit/${m}.glb`]
        if (!url) throw new Error(`no asset for scenery model "${m}"`)
        const root = (await loader.loadAsync(url)).scene
        root.traverse((o) => {
          o.castShadow = o.receiveShadow = true
          if (OPEN_MODELS.includes(m) && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry = capOpenEdges((o as THREE.Mesh).geometry)
        })
        models.set(m, root)
      }),
  )
  const group = new THREE.Group()
  group.name = 'scenery'
  // Generated models are 2–7 meshes each: bake every placed copy into one mesh (decor/instance.ts) instead of a
  // clone per prop, which on WebGL2 would cost a draw call per part. Kit glbs are cloned as before.
  const baked = new Map<string, THREE.Matrix4[]>()
  for (const p of planScenery(track, 9, 7, all, keepClear)) {
    if (isGen(p.model)) {
      baked.set(p.model, [...(baked.get(p.model) ?? []), placement(p.x, p.y, p.z, p.heading, p.scale)])
      continue
    }
    const obj = models.get(p.model)!.clone()
    obj.position.set(p.x, p.y, p.z)
    obj.rotation.y = p.heading
    obj.scale.setScalar(p.scale)
    group.add(obj)
  }
  const parts = [...baked].flatMap(([m, at]) => bakeModel(models.get(m)!, at))
  if (parts.length > 0) {
    const mesh = merged(parts, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }))
    mesh.name = 'generated-scenery'
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
