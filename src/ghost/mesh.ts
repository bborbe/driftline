// Ghost car: the same registry model as the player (build-time VITE_CAR), rendered translucent, in
// the contrasting livery ghostLivery() picks for the player's (render/car/livery.ts).
import * as THREE from 'three/webgpu'
import { createCarView, type CarView } from '../render/car/model'
import type { Livery } from '../render/car/livery'

export const GHOST_OPACITY = 0.35

/** Make every mesh under `root` translucent with its own material copies; casts no shadow. */
export const ghostify = (root: THREE.Object3D): void => {
  const fade = (m: THREE.Material): THREE.Material => {
    const c = m.clone()
    c.transparent = true
    c.opacity = GHOST_OPACITY
    c.depthWrite = false
    return c
  }
  root.traverse((o) => {
    o.castShadow = false
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fade) : fade(mesh.material)
  })
}

/** Hidden until a best run exists; pose it each frame with `update(state, dt)`. */
export const createGhostCar = async (id?: string, livery?: Livery): Promise<CarView> => {
  const car = await createCarView(id, livery)
  ghostify(car.object)
  car.object.visible = false
  return car
}
