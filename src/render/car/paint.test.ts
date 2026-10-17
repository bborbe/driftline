import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { resolveCar } from '../cars'
import { WHEEL_NODES } from '../../car/wheels'
import { applyLivery, type LiveryCanvas } from './paint'

const fakeCanvas = (): LiveryCanvas & { draws: number } => {
  const c = {
    width: 0,
    height: 0,
    draws: 0,
    getContext: () =>
      new Proxy(
        {},
        {
          get: (_t, k) => (k === 'fillText' ? () => void c.draws++ : () => {}),
          set: () => true,
        },
      ),
  }
  return c
}

const liveryMeshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  root.traverse((o) => o.name === 'livery' && out.push(o as THREE.Mesh))
  return out
}

describe('paint', () => {
  it('moves the clearcoat body of a code-built car into livery meshes, never the wheels', async () => {
    const car = await resolveCar('stadium').build()
    const canvas = fakeCanvas()
    applyLivery(car, { pattern: 'checker', paint: 'blue', number: 3 }, () => canvas)
    const painted = liveryMeshes(car)
    expect(painted.length).toBeGreaterThan(0)
    for (const m of painted) {
      for (let p: THREE.Object3D | null = m; p; p = p.parent) expect(Object.values(WHEEL_NODES)).not.toContain(p.name)
      const uv = m.geometry.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0)
        expect(uv.getX(i)).toBeLessThanOrEqual(1)
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0)
        expect(uv.getY(i)).toBeLessThanOrEqual(1)
      }
    }
    expect(canvas.draws).toBe(3) // nose, left, right
  })

  it('repaints by redrawing the same texture, without splitting again', async () => {
    const car = await resolveCar('box').build()
    const canvas = fakeCanvas()
    applyLivery(car, { pattern: 'solid', paint: 'red', number: 1 }, () => canvas)
    const first = liveryMeshes(car)
    const tex = (first[0].material as THREE.MeshPhysicalMaterial).map
    applyLivery(car, { pattern: 'flag', paint: 'lime', number: 2 }, () => canvas)
    expect(liveryMeshes(car)).toEqual(first)
    expect((first[0].material as THREE.MeshPhysicalMaterial).map).toBe(tex)
    expect(canvas.draws).toBe(6)
  })

  it('does nothing without a canvas', async () => {
    const car = await resolveCar('box').build()
    applyLivery(car, { pattern: 'solid', paint: 'red', number: 1 }, () => null)
    expect(liveryMeshes(car)).toEqual([])
  })
})
