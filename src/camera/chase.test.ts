import { describe, expect, it } from 'vitest'
import { createChase, fovForSpeed, updateChase } from './chase'
import { DT, MAX_SPEED, v3 } from '../physics'
import { length, sub } from '../physics/vec'

describe('chase camera', () => {
  it('FOV is 70 at rest and 90 at max speed (40 m/s)', () => {
    expect(MAX_SPEED).toBe(40)
    expect(fovForSpeed(0)).toBe(70)
    expect(fovForSpeed(MAX_SPEED)).toBe(90)
    expect(fovForSpeed(20)).toBeCloseTo(80)
  })

  it('stays within 8 m of a car moving at max speed', () => {
    const fwd = v3(0, 0, 1)
    let target = v3()
    let cam = createChase(target, fwd)
    let maxDist = 0
    for (let t = 0; t < 500; t++) {
      target = v3(0, 0.5, target.z + MAX_SPEED * DT)
      cam = updateChase(cam, target, fwd, MAX_SPEED, DT)
      maxDist = Math.max(maxDist, length(sub(cam.position, target)))
    }
    expect(cam.fov).toBe(90)
    expect(maxDist).toBeLessThanOrEqual(8)
    expect(cam.position.z).toBeLessThan(target.z) // behind the car
  })
})
