import { describe, expect, it } from 'vitest'
import { nextOption, nudge, padFocusKey, padKind } from './pad-focus'

describe('control kinds', () => {
  it('reads selects, sliders and number fields as adjustable, buttons and checkboxes as presses', () => {
    expect(padKind('SELECT')).toBe('select')
    expect(padKind('INPUT', 'range')).toBe('range')
    expect(padKind('INPUT', 'number')).toBe('number')
    expect(padKind('INPUT', 'checkbox')).toBe('press')
    expect(padKind('INPUT', 'text')).toBe('text')
    expect(padKind('BUTTON')).toBe('press')
    expect(padKind('SUMMARY')).toBe('press')
  })
})

describe('pad focus keys', () => {
  it('the first arrow focuses the first control; Enter with nothing focused is not ours', () => {
    expect(padFocusKey(null, 4, null, 'ArrowDown')).toEqual({ type: 'focus', index: 0 })
    expect(padFocusKey(null, 4, null, 'ArrowLeft')).toEqual({ type: 'focus', index: 0 })
    expect(padFocusKey(null, 4, null, 'Enter')).toBeNull()
    expect(padFocusKey(null, 0, null, 'ArrowDown')).toBeNull()
  })

  it('up / down move and wrap', () => {
    expect(padFocusKey(0, 3, 'press', 'ArrowDown')).toEqual({ type: 'focus', index: 1 })
    expect(padFocusKey(2, 3, 'select', 'ArrowDown')).toEqual({ type: 'focus', index: 0 })
    expect(padFocusKey(0, 3, 'range', 'ArrowUp')).toEqual({ type: 'focus', index: 2 })
  })

  it('left / right adjust a select, slider or number, and move between buttons and checkboxes', () => {
    expect(padFocusKey(1, 3, 'select', 'ArrowRight')).toEqual({ type: 'adjust', delta: 1 })
    expect(padFocusKey(1, 3, 'range', 'ArrowLeft')).toEqual({ type: 'adjust', delta: -1 })
    expect(padFocusKey(1, 3, 'number', 'ArrowRight')).toEqual({ type: 'adjust', delta: 1 })
    expect(padFocusKey(1, 3, 'press', 'ArrowRight')).toEqual({ type: 'focus', index: 2 })
    expect(padFocusKey(1, 3, 'text', 'ArrowLeft')).toEqual({ type: 'focus', index: 0 })
  })

  it('A (Enter) and Space press the focused control; other keys are not ours', () => {
    expect(padFocusKey(1, 3, 'press', 'Enter')).toEqual({ type: 'activate' })
    expect(padFocusKey(1, 3, 'select', 'Space')).toEqual({ type: 'activate' })
    expect(padFocusKey(1, 3, 'press', 'KeyQ')).toBeNull()
    expect(padFocusKey(1, 3, 'press', 'Escape')).toBeNull()
  })

  it('a focus index past a page that shrank starts over at the top', () => {
    expect(padFocusKey(5, 3, null, 'ArrowDown')).toEqual({ type: 'focus', index: 0 })
  })
})

describe('adjusting values', () => {
  it('a volume slider steps by its step and stops at the ends', () => {
    expect(nudge(0.5, 0, 1, 0.05, 1)).toBe(0.55)
    expect(nudge(0.05, 0, 1, 0.05, -1)).toBe(0)
    expect(nudge(0, 0, 1, 0.05, -1)).toBe(0)
    expect(nudge(1, 0, 1, 0.05, 1)).toBe(1)
  })

  it('a race number steps by one inside its range, snapping an off-grid value', () => {
    expect(nudge(7, 1, 99, 1, 1)).toBe(8)
    expect(nudge(1, 1, 99, 1, -1)).toBe(1)
    expect(nudge(0.33, 0, 1, 0.05, 1)).toBe(0.4)
  })

  it('a select stops at its ends on left / right and cycles on A', () => {
    expect(nextOption(0, 3, -1)).toBe(0)
    expect(nextOption(2, 3, 1)).toBe(2)
    expect(nextOption(1, 3, 1)).toBe(2)
    expect(nextOption(2, 3, 1, true)).toBe(0)
    expect(nextOption(0, 3, -1, true)).toBe(2)
  })
})
