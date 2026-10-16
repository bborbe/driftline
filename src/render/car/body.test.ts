import { describe, expect, it } from 'vitest'
import { createBodyFeel, updateBodyFeel, type BodyFeel } from './body'
import { quatIdentity, v3, type Vec3 } from '../../physics'

const q = quatIdentity()
const run = (frames: number, vel: (i: number) => Vec3, dt = 1 / 60): BodyFeel => {
  let b = createBodyFeel()
  for (let i = 0; i < frames; i++) b = updateBodyFeel(b, vel(i), q, dt)
  return b
}

describe('body feel', () => {
  it('rests flat at constant velocity', () => {
    const b = run(120, () => v3(0, 0, 20))
    expect(Math.abs(b.roll.x)).toBeLessThan(1e-9)
    expect(Math.abs(b.pitch.x)).toBeLessThan(1e-9)
    expect(Math.abs(b.squat.x)).toBeLessThan(1e-9)
  })

  it('dips the nose under braking and lifts it under throttle', () => {
    expect(run(30, (i) => v3(0, 0, 30 - i * 0.2)).pitch.x).toBeGreaterThan(0.01)
    expect(run(30, (i) => v3(0, 0, i * 0.1)).pitch.x).toBeLessThan(-0.01)
  })

  it('rolls away from the turn', () => {
    // Accelerating toward +x (left): roof tilts right, positive roll.
    expect(run(30, (i) => v3(i * 0.15, 0, 20)).roll.x).toBeGreaterThan(0.01)
    expect(run(30, (i) => v3(-i * 0.15, 0, 20)).roll.x).toBeLessThan(-0.01)
  })

  it('stays bounded on very long frames', () => {
    const b = run(20, (i) => v3(i % 2 ? 15 : -15, 0, 20), 1)
    expect(Math.abs(b.roll.x)).toBeLessThan(0.2)
  })

  it('squats on landing and settles back', () => {
    const landAt = 30
    const vel = (i: number) => (i < landAt ? v3(0, -6, 10) : v3(0, 0, 10))
    let b = createBodyFeel()
    let lowest = 0
    for (let i = 0; i < landAt + 10; i++) {
      b = updateBodyFeel(b, vel(i), q, 1 / 60)
      lowest = Math.min(lowest, b.squat.x)
    }
    expect(lowest).toBeLessThan(-0.05)
    for (let i = 0; i < 120; i++) b = updateBodyFeel(b, v3(0, 0, 10), q, 1 / 60)
    expect(Math.abs(b.squat.x)).toBeLessThan(0.005)
  })
})
