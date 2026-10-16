import { describe, expect, it } from 'vitest'
import { escapeLeavesFullscreen } from './fullscreen'

describe('fullscreen Esc', () => {
  it('an Esc while fullscreen, or right after leaving it, does not pause', () => {
    expect(escapeLeavesFullscreen(true, 1000, -Infinity)).toBe(true)
    expect(escapeLeavesFullscreen(false, 1100, 1000)).toBe(true)
  })

  it('a plain Esc outside fullscreen pauses', () => {
    expect(escapeLeavesFullscreen(false, 5000, 1000)).toBe(false)
    expect(escapeLeavesFullscreen(false, 5000, -Infinity)).toBe(false)
  })
})
