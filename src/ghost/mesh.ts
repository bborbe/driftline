// Translucent ghost car, same silhouette as the player car.
import * as THREE from 'three/webgpu'
import type { CarState } from '../physics'

export const GHOST_OPACITY = 0.35

export const createGhostMesh = (): THREE.Group => {
  const material = new THREE.MeshStandardMaterial({ color: 0x9ad1ff, transparent: true, opacity: GHOST_OPACITY, depthWrite: false })
  const ghost = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), material)
  body.position.y = 0.1
  ghost.add(body)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), material)
  nose.position.set(0, 0.55, 1.6)
  ghost.add(nose)
  ghost.visible = false
  return ghost
}

export const placeGhost = (ghost: THREE.Group, s: CarState): void => {
  ghost.position.set(s.position.x, s.position.y, s.position.z)
  ghost.quaternion.set(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w)
}
