import { describe, expect, it } from 'vitest'
import { outlinePath } from './thumbnail'

describe('outlinePath', () => {
  it('fits the points into the box', () => {
    const d = outlinePath([{ x: 0, y: 0, z: 0, heading: 0 }, { x: 100, y: 0, z: 50, heading: 0 }], 116)
    expect(d).toBe('M8.0 8.0 L108.0 58.0')
  })
  it('is empty with no points', () => {
    expect(outlinePath([], 100)).toBe('')
  })
})
