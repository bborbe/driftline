import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { createCar } from '../physics'
import { createGhostMesh, placeGhost } from './mesh'

describe('ghost mesh', () => {
  it('is translucent and hidden until a best run exists', () => {
    const ghost = createGhostMesh()
    expect(ghost.visible).toBe(false)
    for (const child of ghost.children) {
      const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
      expect(m.transparent).toBe(true)
      expect(m.opacity).toBeLessThan(1)
    }
  })

  it('follows the replayed car state', () => {
    const ghost = createGhostMesh()
    const s = createCar()
    placeGhost(ghost, s)
    expect(ghost.position.toArray()).toEqual([s.position.x, s.position.y, s.position.z])
  })
})
