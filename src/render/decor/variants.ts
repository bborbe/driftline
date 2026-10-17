// Code-generated scenery models: three tree variants and three building variants, built from
// closed primitives (boxes, cones, cylinders, icosahedra, extruded gables) so every part is
// watertight for the scene lint (lint.ts). Sized in metres, base at y 0, front toward +z. Original
// shapes: no third-party assets. Scenery (scenery.ts) places them; ids carry a `gen:` prefix so a
// theme's model list can mix them with Kenney glbs.
import * as THREE from 'three/webgpu'

export const GEN_TREES = ['gen:pine', 'gen:oak', 'gen:poplar'] as const
export const GEN_BUILDINGS = ['gen:house', 'gen:office', 'gen:garage'] as const
export type GenModel = (typeof GEN_TREES)[number] | (typeof GEN_BUILDINGS)[number]

export const isGen = (model: string): model is GenModel => (GEN_TREES as readonly string[]).includes(model) || (GEN_BUILDINGS as readonly string[]).includes(model)
export const isBuilding = (model: string): boolean => (GEN_BUILDINGS as readonly string[]).includes(model)

/** Footprint radius of each model, metres: how far its widest part reaches from its origin. */
export const GEN_RADIUS: Record<GenModel, number> = {
  'gen:pine': 2.5,
  'gen:oak': 3.4,
  'gen:poplar': 1.4,
  'gen:house': 6.5,
  'gen:office': 8,
  'gen:garage': 12.5,
}

const mat = (hex: number, name: string) => {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, flatShading: true })
  m.name = name
  return m
}
const BARK = mat(0x6b4a2f, 'bark')
const BIRCH = mat(0xd9d4c7, 'birch-bark')
const PINE = mat(0x2f5d34, 'pine')
const OAK = mat(0x4f8a3a, 'oak')
const OAK_LIGHT = mat(0x6aa346, 'oak-light')
const POPLAR = mat(0x5f9a3c, 'poplar')
const WALL = mat(0xe8dcc0, 'wall')
const ROOF = mat(0x9b3b2a, 'roof')
const GLASS = mat(0x23384a, 'glass')
const CONCRETE = mat(0x9aa1a8, 'concrete')
const STEEL = mat(0x6f7a84, 'steel')
const DOOR = mat(0x2b2b2b, 'door')
const STRIPE = mat(0xffd21f, 'stripe')

const at = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, name: string): THREE.Mesh => {
  const mesh = new THREE.Mesh(geo, m)
  mesh.position.set(x, y, z)
  mesh.name = name
  return mesh
}
/** A box standing on height `y` (its base), centred on x/z. */
const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, name: string) => at(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, name)

/** A gable roof: a triangle `w` wide and `h` high, extruded `d` deep along z, eaves at height `y`. */
const gable = (w: number, h: number, d: number, m: THREE.Material, y: number, name: string): THREE.Mesh => {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)])
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false })
  geo.translate(0, 0, -d / 2)
  return at(geo, m, 0, y, 0, name)
}

/** Tall pine: thin trunk under three stacked cones, ~8 m. */
const pine = (): THREE.Object3D[] => [
  at(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6), BARK, 0, 0.8, 0, 'trunk'),
  at(new THREE.ConeGeometry(2.4, 3.2, 7), PINE, 0, 1.2 + 1.6, 0, 'tier-low'),
  at(new THREE.ConeGeometry(1.8, 2.8, 7), PINE, 0, 3.4 + 1.4, 0, 'tier-mid'),
  at(new THREE.ConeGeometry(1.15, 2.4, 7), PINE, 0, 5.4 + 1.2, 0, 'tier-top'),
]

/** Broad oak: short thick trunk, a lumpy crown of three overlapping blobs, ~7 m, wider than tall. */
const oak = (): THREE.Object3D[] => {
  const blob = (r: number, m: THREE.Material, x: number, y: number, z: number, name: string) => {
    const g = new THREE.IcosahedronGeometry(r, 1)
    g.scale(1, 0.8, 1)
    return at(g, m, x, y, z, name)
  }
  return [
    at(new THREE.CylinderGeometry(0.35, 0.5, 3, 7), BARK, 0, 1.5, 0, 'trunk'),
    blob(2.4, OAK, 0, 4.6, 0, 'crown'),
    blob(1.7, OAK_LIGHT, 1.6, 4.1, 0.6, 'crown-east'),
    blob(1.6, OAK, -1.4, 4.3, -0.9, 'crown-west'),
  ]
}

/** Slender poplar: pale trunk under a tall narrow spindle, ~10 m. */
const poplar = (): THREE.Object3D[] => {
  const crown = new THREE.IcosahedronGeometry(1, 1)
  crown.scale(1.35, 4.2, 1.35)
  return [at(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6), BIRCH, 0, 1.1, 0, 'trunk'), at(crown, POPLAR, 0, 5.6, 0, 'crown')]
}

/** Cottage: cream walls, red gable roof, a door and two windows on the front, a chimney. */
const house = (): THREE.Object3D[] => [
  box(9, 4, 7, WALL, 0, 0, 0, 'walls'),
  gable(10, 3.2, 8, ROOF, 4, 'roof'),
  box(1.2, 2.2, 0.2, DOOR, 0, 0, 3.55, 'door'),
  box(1.6, 1.2, 0.2, GLASS, -2.8, 1.6, 3.55, 'window-left'),
  box(1.6, 1.2, 0.2, GLASS, 2.8, 1.6, 3.55, 'window-right'),
  box(0.8, 2.6, 0.8, CONCRETE, 2.4, 4.4, -1.2, 'chimney'),
]

/** Office block: a grey tower with four dark window bands and a rooftop plant box, ~18 m. */
const office = (): THREE.Object3D[] => {
  const parts: THREE.Object3D[] = [box(12, 16, 10, CONCRETE, 0, 0, 0, 'tower'), box(4, 2, 3, STEEL, 2, 16, -1, 'rooftop-plant')]
  for (let k = 0; k < 4; k++) parts.push(box(12.3, 1.6, 10.3, GLASS, 0, 2.5 + k * 3.4, 0, `windows-${k}`))
  return parts
}

/** Pit garage row: long low box, four roller doors with a yellow stripe above, a flat roof overhang. */
const garage = (): THREE.Object3D[] => {
  const parts: THREE.Object3D[] = [
    box(22, 5, 9, STEEL, 0, 0, 0, 'body'),
    box(23, 0.4, 11, CONCRETE, 0, 5, 0.8, 'roof'),
    box(22.1, 0.5, 0.2, STRIPE, 0, 4.2, 4.55, 'stripe'),
  ]
  for (let k = 0; k < 4; k++) parts.push(box(4, 3.6, 0.2, DOOR, -7.5 + k * 5, 0, 4.55, `door-${k}`))
  return parts
}

const BUILD: Record<GenModel, () => THREE.Object3D[]> = {
  'gen:pine': pine,
  'gen:oak': oak,
  'gen:poplar': poplar,
  'gen:house': house,
  'gen:office': office,
  'gen:garage': garage,
}

/** A fresh model root for `model`: every mesh casts and receives shadows. */
export const createGenModel = (model: GenModel): THREE.Group => {
  const root = new THREE.Group()
  root.name = model
  for (const o of BUILD[model]()) {
    o.castShadow = o.receiveShadow = true
    root.add(o)
  }
  return root
}
