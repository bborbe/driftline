// Car registry. The car is chosen at build time: VITE_CAR=<id> (default `race`);
// an unknown id falls back to `box`. Every entry exposes the four wheel nodes named in
// src/car/wheels.ts, so steering and wheel spin work the same for every model.
//
// Adding an entry: CC0, CC-BY or MIT assets only, licence recorded under assets/LICENSES/.
// Never Nadeo-derived — no Trackmania car rips or recreations (Sketchfab "stadium car" models included).
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { WHEEL_NODES, type Corner } from '../car/wheels'
import { fitRig, PHYSICS_WHEEL_DROP, PHYSICS_WHEEL_RADIUS, PHYSICS_WHEELBASE, type WheelNode } from './car/rig'

export type CarId = 'stadium' | 'race' | 'raceFuture' | 'box'

export type CarEntry = {
  id: CarId
  label: string
  /** glb path relative to the repo root, for models loaded from assets/ (tests read it directly). */
  file?: string
  /** Build the model in the car frame, physics-sized, with the four wheel nodes. */
  build: () => Promise<THREE.Object3D>
}

export const DEFAULT_CAR: CarId = 'race'
export const FALLBACK_CAR: CarId = 'box'

// Physics wheel layout (src/physics/car.ts): mounts at x ±0.8, z ±1.3.
const TRACK_HALF = 0.8
const AXLE_Z = PHYSICS_WHEELBASE / 2

const corners: Record<Corner, [number, number]> = {
  fl: [TRACK_HALF, AXLE_Z],
  fr: [-TRACK_HALF, AXLE_Z],
  rl: [TRACK_HALF, -AXLE_Z],
  rr: [-TRACK_HALF, -AXLE_Z],
}

const tyre = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.9 })
const rim = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.6, roughness: 0.35 })

/** A wheel node at a physics corner: axle along x, centre on the suspension rest pose. */
const wheel = (corner: Corner, width: number): THREE.Group => {
  const node = new THREE.Group()
  node.name = WHEEL_NODES[corner]
  const [x, z] = corners[corner]
  node.position.set(x, -PHYSICS_WHEEL_DROP, z)
  node.rotation.order = 'YXZ'
  const t = new THREE.Mesh(new THREE.CylinderGeometry(PHYSICS_WHEEL_RADIUS, PHYSICS_WHEEL_RADIUS, width, 20), tyre)
  t.rotation.z = Math.PI / 2
  const r = new THREE.Mesh(new THREE.CylinderGeometry(PHYSICS_WHEEL_RADIUS * 0.55, PHYSICS_WHEEL_RADIUS * 0.55, width + 0.02, 12), rim)
  r.rotation.z = Math.PI / 2
  node.add(t, r)
  return node
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}

/** Original open-wheel stadium-style car: low wedge, exposed wheels, splitter, big rear wing. */
const buildStadium = async (): Promise<THREE.Object3D> => {
  const primary = new THREE.MeshPhysicalMaterial({ color: 0x0b7a75, clearcoat: 1, roughness: 0.3 }) // deep teal
  const accent = new THREE.MeshPhysicalMaterial({ color: 0xf4a259, clearcoat: 1, roughness: 0.3 }) // warm orange
  const carbon = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 })
  const car = new THREE.Group()

  // Wedge tub: tall at the cockpit, sloping down to a sharp nose.
  const side = new THREE.Shape()
  side.moveTo(-1.9, -0.45)
  side.lineTo(2.1, -0.45)
  side.lineTo(2.1, -0.32)
  side.lineTo(0.2, 0.12)
  side.lineTo(-1.2, 0.2)
  side.lineTo(-1.9, 0.05)
  side.closePath()
  const tub = new THREE.Mesh(new THREE.ExtrudeGeometry(side, { depth: 0.9, bevelEnabled: false }), primary)
  tub.rotation.y = -Math.PI / 2 // profile x -> car z; extrude depth 0..0.9 -> car x -0.9..0
  tub.position.x = 0.45 // centre the 0.9 m tub on the car axis
  car.add(tub)

  car.add(
    box(0.92, 0.06, 1.6, accent, 0, -0.06, 1.0), // livery stripe along the nose
    box(1.9, 0.05, 0.45, carbon, 0, -0.48, 2.05), // front splitter
    box(0.5, 0.22, 0.7, carbon, 0, 0.27, -0.35), // cockpit cowl
    box(0.35, 0.3, 1.1, accent, 0.62, -0.25, -0.6), // side pods
    box(0.35, 0.3, 1.1, accent, -0.62, -0.25, -0.6),
    box(0.08, 0.55, 0.08, carbon, 0.35, 0.15, -1.75), // wing struts
    box(0.08, 0.55, 0.08, carbon, -0.35, 0.15, -1.75),
    box(1.8, 0.06, 0.5, primary, 0, 0.45, -1.8), // rear wing
    box(0.06, 0.35, 0.55, accent, 0.9, 0.38, -1.8), // wing endplates
    box(0.06, 0.35, 0.55, accent, -0.9, 0.38, -1.8),
  )
  for (const c of Object.keys(corners) as Corner[]) car.add(wheel(c, 0.36))
  return car
}

/** The original placeholder box, now with wheels; the fallback for every failure. */
const buildBox = async (): Promise<THREE.Object3D> => {
  const car = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xd62828, clearcoat: 1, roughness: 0.3 })
  car.add(box(1.8, 0.7, 4.2, paint, 0, 0.1, 0))
  car.add(box(1.2, 0.3, 0.6, new THREE.MeshStandardMaterial({ color: 0xffffff }), 0, 0.55, 1.6))
  for (const c of Object.keys(corners) as Corner[]) car.add(wheel(c, 0.3))
  return car
}

const MODEL_URLS = import.meta.glob('/assets/car-kit/{race,race-future}.glb', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>

/** Load a Kenney Car Kit glb and fit it to the physics chassis by its wheel nodes. */
const glbCar = (file: string) => async (): Promise<THREE.Object3D> => {
  const url = await MODEL_URLS[`/${file}`]()
  const model = (await new GLTFLoader().loadAsync(url)).scene
  const nodes: WheelNode[] = Object.values(WHEEL_NODES).map((name) => {
    const n = model.getObjectByName(name)
    if (!n) throw new Error(`${file} has no wheel node "${name}"`)
    const b = new THREE.Box3().setFromObject(n)
    return { name, translation: n.position.toArray() as [number, number, number], radius: (b.max.y - b.min.y) / 2 }
  })
  const rig = fitRig(nodes)
  model.scale.setScalar(rig.scale)
  model.position.set(...rig.offset)
  for (const name of Object.values(WHEEL_NODES)) {
    const w = model.getObjectByName(name)!
    w.position.y = rig.wheelY
    w.scale.setScalar(rig.wheelScale)
    w.rotation.order = 'YXZ'
  }
  const root = new THREE.Group()
  root.add(model)
  return root
}

export const CARS: readonly CarEntry[] = [
  { id: 'stadium', label: 'Stadium (original)', build: buildStadium },
  { id: 'race', label: 'Kenney Race', file: 'assets/car-kit/race.glb', build: glbCar('assets/car-kit/race.glb') },
  {
    id: 'raceFuture',
    label: 'Kenney Race Future',
    file: 'assets/car-kit/race-future.glb',
    build: glbCar('assets/car-kit/race-future.glb'),
  },
  { id: 'box', label: 'Placeholder box', build: buildBox },
]

/** Registry entry for an id; unknown ids fall back to the box with a warning. */
export const resolveCar = (id: string | undefined): CarEntry => {
  const want = id || DEFAULT_CAR
  const entry = CARS.find((c) => c.id === want)
  if (entry) return entry
  console.warn(`unknown car "${want}", using ${FALLBACK_CAR}`)
  return CARS.find((c) => c.id === FALLBACK_CAR)!
}

/** The build-time car choice (VITE_CAR). */
export const CAR_ID: string = import.meta.env.VITE_CAR ?? DEFAULT_CAR
