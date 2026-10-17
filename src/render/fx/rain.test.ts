import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { createRain, dropCoord, RAIN_BOX, RAIN_DROPS, wrap } from './rain'

describe('rain', () => {
  it('wrap keeps a value in [0, size)', () => {
    expect(wrap(-1, 10)).toBe(9)
    expect(wrap(12, 10)).toBe(2)
    expect(wrap(0, 10)).toBe(0)
  })

  it('places every drop within half a box of the camera, wherever it is', () => {
    for (const c of [-1234.5, 0, 87.25, 5000]) for (const o of [0, 13, 49.9]) expect(Math.abs(dropCoord(o, c, 50) - c)).toBeLessThanOrEqual(25)
  })

  it('a drop holds still in the world while the camera moves past it (no swimming)', () => {
    expect(dropCoord(10, 3, 50)).toBe(dropCoord(10, 7, 50))
  })

  it('updates every drop around the camera in one instanced mesh', () => {
    const rain = createRain(1)
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(100, 5, -40)
    cam.updateMatrixWorld()
    rain.update(1 / 60, cam)
    expect(rain.object.count).toBe(RAIN_DROPS)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (let i = 0; i < RAIN_DROPS; i += 97) {
      rain.object.getMatrixAt(i, m)
      p.setFromMatrixPosition(m)
      expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(RAIN_BOX[0] / 2)
      expect(Math.abs(p.y - 5)).toBeLessThanOrEqual(RAIN_BOX[1] / 2)
      expect(Math.abs(p.z + 40)).toBeLessThanOrEqual(RAIN_BOX[2] / 2)
    }
  })
})
