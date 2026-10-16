import { describe, expect, it } from 'vitest'
import { debugToggle } from './overlay'

describe('debug overlay toggle', () => {
  it('backtick toggles the overlay', () => {
    expect(debugToggle('Backquote', false, false, false)).toBe(true)
  })

  it('a repeat, a modifier, a field or another key does not', () => {
    expect(debugToggle('Backquote', true, false, false)).toBe(false)
    expect(debugToggle('Backquote', false, true, false)).toBe(false)
    expect(debugToggle('Backquote', false, false, true)).toBe(false)
    expect(debugToggle('KeyP', false, false, false)).toBe(false)
  })
})
