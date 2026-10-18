import { describe, expect, it } from 'vitest'
import { v3 } from '../physics/vec'
import { MENU_ORBIT_RATE, menuCamera } from './scene'

const car = v3(10, 2, -5)
const angleOf = (eye: { x: number; z: number }) => Math.atan2(eye.x - car.x, eye.z - car.z)

describe('menuCamera', () => {
  it('starts in front of the car, three-quarter view, looking at it', () => {
    const { eye, target } = menuCamera(0, car, 0)
    // heading 0 faces +z: the eye is ahead of the car (z > car.z), 45° off to the side.
    expect(eye.z).toBeGreaterThan(car.z)
    expect(angleOf(eye)).toBeCloseTo(Math.PI / 4, 6)
    expect(target.x).toBe(car.x)
    expect(target.z).toBe(car.z)
  })
  it('circles at a fixed radius and height', () => {
    for (const t of [0, 3, 30]) {
      const { eye } = menuCamera(t, car, 1.2)
      expect(Math.hypot(eye.x - car.x, eye.z - car.z)).toBeCloseTo(6.2, 6)
      expect(eye.y - car.y).toBeCloseTo(1.9, 6)
    }
  })
  it('moves about 6° per second, so two frames 2 s apart differ', () => {
    const d = angleOf(menuCamera(2, car, 0).eye) - angleOf(menuCamera(0, car, 0).eye)
    expect(d).toBeCloseTo(2 * MENU_ORBIT_RATE, 6)
    expect((MENU_ORBIT_RATE * 180) / Math.PI).toBeGreaterThan(5)
    expect((MENU_ORBIT_RATE * 180) / Math.PI).toBeLessThan(8)
  })
})
