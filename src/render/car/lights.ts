// Car lights and glowing rims, added to any registry car (box, stadium, Kenney glbs) from its
// bounding box and wheel nodes, so every model gets the same glow. Tail lights brighten on the
// brake. Render-only: the caller passes the brake state, nothing here reads physics.
import * as THREE from 'three/webgpu'
import { WHEEL_NODES } from '../../car/wheels'
import { glowMaterial, tailLightIntensity } from '../glow'
import { PHYSICS_WHEEL_RADIUS } from './rig'

export type CarLights = {
  /** Brighten the tail lights while braking. */
  setBraking: (braking: boolean) => void
}

const lamp = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.castShadow = false
  return m
}

/**
 * Add two tail lights at the rear (−z), two headlights at the nose (+z) and a glowing ring on the
 * outer face of every wheel. `root` must be in the car frame (unposed), as the registry builds it.
 */
export const attachLights = (root: THREE.Object3D): CarLights => {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const tail = glowMaterial('tail-light')
  const head = glowMaterial('headlight')
  const rim = glowMaterial('rim')
  const lamps = new THREE.Group()
  lamps.name = 'lights'
  const lx = size.x * 0.3
  for (const side of [1, -1]) {
    lamps.add(lamp(size.x * 0.22, 0.12, 0.04, tail, side * lx, box.min.y + size.y * 0.5, box.min.z - 0.01))
    lamps.add(lamp(size.x * 0.2, 0.08, 0.04, head, side * lx, box.min.y + size.y * 0.4, box.max.z + 0.01))
  }
  root.add(lamps)

  const scale = new THREE.Vector3()
  const bounds = new THREE.Box3()
  const centre = new THREE.Vector3()
  for (const name of Object.values(WHEEL_NODES)) {
    const wheel = root.getObjectByName(name)
    if (!wheel) continue
    // Size the ring from the wheel's own bounds (models differ in tyre width), just proud of its outer
    // face; metres are divided by the node's world scale, since glbs scale their wheels. A glb wheel's
    // origin sits on its inner face, so the ring is placed from the bounds, not from the origin.
    const s = wheel.getWorldScale(scale).x || 1
    if (bounds.setFromObject(wheel).isEmpty()) bounds.setFromCenterAndSize(wheel.getWorldPosition(centre), new THREE.Vector3(0.3, 2 * PHYSICS_WHEEL_RADIUS, 0))
    bounds.getCenter(centre)
    const radius = (bounds.max.y - bounds.min.y) / 2
    const side = Math.sign(centre.x) || 1
    centre.x = side > 0 ? bounds.max.x + 0.01 : bounds.min.x - 0.01
    const ring = new THREE.Mesh(new THREE.TorusGeometry((radius * 0.5) / s, 0.02 / s, 6, 24), rim)
    ring.name = 'rim-glow'
    ring.rotation.y = Math.PI / 2 // torus axis along the axle (x)
    ring.position.copy(wheel.worldToLocal(centre))
    ring.castShadow = false
    wheel.add(ring)
  }

  let braking = false
  return {
    setBraking: (b) => {
      if (b === braking) return
      braking = b
      tail.emissiveIntensity = tailLightIntensity(b)
    },
  }
}
