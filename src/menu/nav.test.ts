import { describe, expect, it } from 'vitest'
import { isSelectKey, moveFocus } from './nav'

describe('moveFocus', () => {
  it('wraps both ways', () => {
    expect(moveFocus(0, 4, 'ArrowUp')).toBe(3)
    expect(moveFocus(3, 4, 'ArrowDown')).toBe(0)
    expect(moveFocus(1, 4, 'ArrowRight')).toBe(2)
  })
  it('ignores other keys and empty lists', () => {
    expect(moveFocus(2, 4, 'KeyX')).toBe(2)
    expect(moveFocus(0, 0, 'ArrowDown')).toBe(0)
  })
  it('selects on Enter and Space', () => {
    expect(isSelectKey('Enter')).toBe(true)
    expect(isSelectKey('Space')).toBe(true)
    expect(isSelectKey('Escape')).toBe(false)
  })
})
