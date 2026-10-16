import { describe, expect, it } from 'vitest'
import { createGround } from './scene'

describe('ground plane', () => {
  it('never occludes the road: drawn first, no depth writes', () => {
    const g = createGround()
    expect((g.material as { depthWrite: boolean }).depthWrite).toBe(false)
    expect(g.renderOrder).toBeLessThan(0)
  })
})
