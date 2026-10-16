import { describe, expect, it } from 'vitest'
import { createCarAt, forwardOf } from '../physics'
import { debugPose, frozen, poseQuery, yawDeg } from './debug-pose'

describe('debugPose', () => {
  it('parses x, y, z and yaw in degrees', () => {
    const p = debugPose('?track=lap2&x=-108&y=0.8&z=-59&yaw=90')
    expect(p).toEqual({ x: -108, y: 0.8, z: -59, heading: Math.PI / 2 })
  })

  it('is null when any coordinate is missing or not a number', () => {
    expect(debugPose('')).toBeNull()
    expect(debugPose('?x=1&y=0&z=2')).toBeNull()
    expect(debugPose('?x=1&y=&z=2&yaw=0')).toBeNull()
    expect(debugPose('?x=a&y=0&z=2&yaw=0')).toBeNull()
  })

  it('freeze only on freeze=1', () => {
    expect(frozen('?freeze=1')).toBe(true)
    expect(frozen('?freeze=0')).toBe(false)
    expect(frozen('')).toBe(false)
  })

  it('HUD yaw round-trips through the spawn URL to the same facing', () => {
    for (const yaw of [0, 37, 90, 179, -45, -120]) {
      const car = createCarAt({ x: 3, y: 0.8, z: -4, heading: (yaw * Math.PI) / 180 })
      const shown = yawDeg(forwardOf(car))
      expect(shown).toBeCloseTo(yaw, 6)
      const back = debugPose(poseQuery('lap2', { x: 3, y: 0.8, z: -4 }, shown))!
      const f = forwardOf(createCarAt(back))
      const g = forwardOf(car)
      expect(f.x).toBeCloseTo(g.x, 6)
      expect(f.z).toBeCloseTo(g.z, 6)
    }
  })

  it('poseQuery builds a frozen debug-spawn query', () => {
    expect(poseQuery('lap2', { x: -108.04, y: 0.8, z: -59 }, 90)).toBe('?track=lap2&x=-108.0&y=0.8&z=-59.0&yaw=90&freeze=1')
  })
})
