import { describe, expect, it } from 'vitest'
import { CHECKPOINT_FLASH_S, CheckpointFlash, flashOpacity } from './checkpoint-flash'

describe('checkpoint flash', () => {
  it(`rises from 0 after the pass and is back to 0 at ${CHECKPOINT_FLASH_S} s`, () => {
    expect(flashOpacity(0)).toBe(0)
    expect(flashOpacity(0.05)).toBeGreaterThan(0)
    expect(flashOpacity(0.15 * CHECKPOINT_FLASH_S)).toBeCloseTo(1, 6)
    expect(flashOpacity(0.5)).toBeGreaterThan(0)
    expect(flashOpacity(0.5)).toBeLessThan(1)
    expect(flashOpacity(CHECKPOINT_FLASH_S)).toBe(0)
    expect(flashOpacity(CHECKPOINT_FLASH_S + 1)).toBe(0)
  })

  it('is dark until a checkpoint triggers it, then follows the curve from that moment', () => {
    const f = new CheckpointFlash()
    expect(f.opacity(10)).toBe(0)
    f.trigger(10)
    expect(f.opacity(10)).toBe(0)
    expect(f.opacity(10.1)).toBeGreaterThan(0.5)
    expect(f.opacity(10 + CHECKPOINT_FLASH_S)).toBe(0)
    expect(f.opacity(20)).toBe(0)
  })

  it('a back-to-back pass restarts the flash', () => {
    const f = new CheckpointFlash()
    f.trigger(0)
    f.trigger(0.7)
    expect(f.opacity(0.8)).toBeGreaterThan(0.5)
  })
})
