import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { createCar } from '../physics'
import { resolveCar } from '../render/cars'
import { createGhostCar, ghostify } from './mesh'

const materials = (root: THREE.Object3D): THREE.Material[] => {
  const out: THREE.Material[] = []
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if ((o as THREE.Mesh).isMesh) out.push(...(Array.isArray(m) ? m : [m]))
  })
  return out
}

describe('ghost car', () => {
  it('uses the registry model, translucent, without touching the source materials', async () => {
    const model = await resolveCar('box').build()
    const before = materials(model)
    const ghost = model.clone()
    ghostify(ghost)
    const after = materials(ghost)
    expect(after.length).toBe(before.length)
    expect(after.length).toBeGreaterThan(0)
    for (const m of after) {
      expect(m.transparent).toBe(true)
      expect(m.opacity).toBeLessThan(1)
    }
    for (const m of before) expect(m.opacity).toBe(1)
  })

  it('is hidden until a best run exists and follows the replayed state', async () => {
    const ghost = await createGhostCar('box')
    expect(ghost.object.visible).toBe(false)
    const s = createCar()
    ghost.update(s, 0.016)
    expect(ghost.object.position.toArray()).toEqual([s.position.x, s.position.y, s.position.z])
  })
})
