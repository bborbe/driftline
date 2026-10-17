import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { RAIN_SPEED } from './rain'
import { createSnow, SNOW_BOX, SNOW_FLAKES, SNOW_SPEED, SNOW_SWAY, sway } from './snow'

const positions = (snow: ReturnType<typeof createSnow>) => {
  const m = new THREE.Matrix4()
  return Array.from({ length: SNOW_FLAKES }, (_, i) => {
    snow.object.getMatrixAt(i, m)
    return new THREE.Vector3().setFromMatrixPosition(m)
  })
}

describe('snow', () => {
  it('falls far slower than rain', () => {
    expect(SNOW_SPEED).toBeLessThan(RAIN_SPEED / 4)
  })

  it('sways sideways within its amplitude', () => {
    for (const t of [0, 0.4, 3.3, 100]) for (const p of [0, 1, 4]) expect(Math.abs(sway(p, t))).toBeLessThanOrEqual(SNOW_SWAY)
  })

  it('keeps every flake within half a box (plus sway) of the camera, in one instanced mesh', () => {
    const snow = createSnow(1)
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(-300, 12, 75)
    cam.updateMatrixWorld()
    snow.update(1 / 60, cam)
    expect(snow.object.count).toBe(SNOW_FLAKES)
    for (const p of positions(snow)) {
      expect(Math.abs(p.x + 300)).toBeLessThanOrEqual(SNOW_BOX[0] / 2 + SNOW_SWAY)
      expect(Math.abs(p.y - 12)).toBeLessThanOrEqual(SNOW_BOX[1] / 2)
      expect(Math.abs(p.z - 75)).toBeLessThanOrEqual(SNOW_BOX[2] / 2 + SNOW_SWAY)
    }
  })

  it('moves the flakes between frames: they fall and drift, not a static tint', () => {
    const snow = createSnow(2)
    const cam = new THREE.PerspectiveCamera()
    cam.updateMatrixWorld()
    snow.update(1 / 60, cam)
    const a = positions(snow)
    snow.update(0.5, cam)
    const b = positions(snow)
    expect(a.filter((p, i) => p.distanceTo(b[i]) > 0.3).length).toBeGreaterThan(SNOW_FLAKES * 0.9)
  })
})
