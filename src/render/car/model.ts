// The player car: the Kenney race model fitted to the physics chassis, with the
// placeholder box as a fallback when the model cannot load. Reads car state only.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { dot, forwardOf, type CarState } from '../../physics'
import { STEERED, WHEEL_NODES, type Corner } from '../../car/wheels'
import { fitRig, spinRate, wheelYaw, type WheelNode } from './rig'

const MODEL_URL = Object.values(
  import.meta.glob('/assets/car-kit/race.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>,
)[0]

export type CarView = {
  object: THREE.Object3D
  /** Pose the car and its wheels from physics state; dt in seconds. */
  update: (s: CarState, dt: number) => void
}

const placeholder = (): THREE.Group => {
  // Box body + nose marker so heading is readable.
  const car = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xd62828, clearcoat: 1, roughness: 0.3 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), paint)
  body.position.y = 0.1
  car.add(body)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff }))
  nose.position.set(0, 0.55, 1.6)
  car.add(nose)
  return car
}

const poseRoot = (root: THREE.Object3D, s: CarState) => {
  root.position.set(s.position.x, s.position.y, s.position.z)
  root.quaternion.set(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w)
}

const loadModel = async (): Promise<CarView> => {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL)
  const model = gltf.scene
  const wheels = new Map<Corner, THREE.Object3D>()
  const nodes: WheelNode[] = []
  for (const [corner, name] of Object.entries(WHEEL_NODES) as [Corner, string][]) {
    const node = model.getObjectByName(name)
    if (!node) throw new Error(`car model has no wheel node "${name}"`)
    const box = new THREE.Box3().setFromObject(node)
    nodes.push({ name, translation: node.position.toArray() as [number, number, number], radius: (box.max.y - box.min.y) / 2 })
    wheels.set(corner, node)
  }
  const rig = fitRig(nodes)
  model.scale.setScalar(rig.scale)
  model.position.set(...rig.offset)
  for (const w of wheels.values()) {
    w.position.y = rig.wheelY
    w.scale.setScalar(rig.wheelScale)
    w.rotation.order = 'YXZ' // steer about y, then roll about the axle
  }
  model.traverse((o) => (o.castShadow = true))

  const root = new THREE.Group()
  root.add(model)
  let roll = 0
  return {
    object: root,
    update: (s, dt) => {
      poseRoot(root, s)
      roll += spinRate(dot(s.velocity, forwardOf(s))) * dt
      for (const [corner, w] of wheels) {
        w.rotation.x = roll
        w.rotation.y = STEERED.includes(corner) ? wheelYaw(s.steerAngle) : 0
      }
    },
  }
}

/** The fitted race model, or the placeholder box if it fails to load. */
export const createCarView = async (): Promise<CarView> => {
  try {
    return await loadModel()
  } catch (err) {
    console.warn(`car model failed to load, using placeholder: ${String(err)}`)
    const box = placeholder()
    box.traverse((o) => (o.castShadow = true))
    return { object: box, update: (s) => poseRoot(box, s) }
  }
}
