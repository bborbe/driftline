import { describe, expect, it } from 'vitest'
import { isMenuKey, isSelectKey, moveFocus, moveGrid } from './nav'

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

describe('moveGrid', () => {
  const rows = [2, 5, 1] // campaign, test, settings
  it('moves within a row and wraps', () => {
    expect(moveGrid({ row: 1, col: 4 }, rows, 'ArrowRight')).toEqual({ row: 1, col: 0 })
    expect(moveGrid({ row: 0, col: 0 }, rows, 'ArrowLeft')).toEqual({ row: 0, col: 1 })
  })
  it('changes row with the column clamped to the row length, wrapping', () => {
    expect(moveGrid({ row: 1, col: 4 }, rows, 'ArrowUp')).toEqual({ row: 0, col: 1 })
    expect(moveGrid({ row: 1, col: 3 }, rows, 'ArrowDown')).toEqual({ row: 2, col: 0 })
    expect(moveGrid({ row: 2, col: 0 }, rows, 'KeyS')).toEqual({ row: 0, col: 0 })
    expect(moveGrid({ row: 0, col: 0 }, rows, 'KeyW')).toEqual({ row: 2, col: 0 })
  })
  it('ignores other keys and an empty grid', () => {
    expect(moveGrid({ row: 1, col: 2 }, rows, 'KeyX')).toEqual({ row: 1, col: 2 })
    expect(moveGrid({ row: 0, col: 0 }, [], 'ArrowDown')).toEqual({ row: 0, col: 0 })
  })
})

describe('isMenuKey', () => {
  it('takes the arrows and the select keys, nothing else', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'Space']) expect(isMenuKey(k)).toBe(true)
    for (const k of ['Escape', 'KeyQ', 'KeyE', 'KeyR', 'Backspace']) expect(isMenuKey(k)).toBe(false)
  })
})
