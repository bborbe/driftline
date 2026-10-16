import { describe, expect, it } from 'vitest'
import { cameraKey } from './controller'

describe('camera keys', () => {
  it('maps 1/2/3 to a view, C to fly and O to orbit', () => {
    expect(cameraKey('Digit1', false, false)).toBe('view')
    expect(cameraKey('Numpad3', false, false)).toBe('view')
    expect(cameraKey('KeyC', false, false)).toBe('fly')
    expect(cameraKey('KeyO', false, false)).toBe('orbit')
  })

  it('ignores repeats, keys typed into a field, and other keys', () => {
    expect(cameraKey('KeyC', true, false)).toBeNull()
    expect(cameraKey('Digit2', false, true)).toBeNull()
    expect(cameraKey('KeyP', false, false)).toBeNull()
    expect(cameraKey('Backquote', false, false)).toBeNull()
  })
})
