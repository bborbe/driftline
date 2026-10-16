import { describe, expect, it } from 'vitest'
import { debugPose, frozen } from './debug-pose'

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
})
