import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { bodyLift, createBodyFeel, updateBodyFeel, type BodyFeel } from './body'
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

describe('bodyLift', () => {
  // The lean as model.ts applies it: root quaternion × Euler(pitch, 0, roll), then squat along the leaned up.
  const leaned = (b: BodyFeel, x: number, z: number): number => {
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.pitch.x, 0, b.roll.x))
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(lean)
    return new THREE.Vector3(x, 0, z).applyQuaternion(lean).y + up.y * b.squat.x
  }

  it('matches the lean model.ts draws at every wheel mount, so the wheels can be given it back', () => {
    for (const [pitch, roll, squat] of [
      [-0.08, 0, 0], // full throttle: nose up, rear down
      [0.08, 0.12, 0], // braking into a turn
      [0.03, -0.1, -0.12], // landing in a turn
    ]) {
      const b: BodyFeel = { ...createBodyFeel(), pitch: { x: pitch, v: 0 }, roll: { x: roll, v: 0 }, squat: { x: squat, v: 0 } }
      for (const [x, z] of [[0.8, 1.3], [-0.8, 1.3], [0.8, -1.3], [-0.8, -1.3]]) expect(bodyLift(b, x, z)).toBeCloseTo(leaned(b, x, z), 2)
    }
  })

  it('is zero on a car at rest', () => {
    expect(bodyLift(createBodyFeel(), 0.8, -1.3)).toBe(0)
  })
})
