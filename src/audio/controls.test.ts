import { describe, expect, it } from 'vitest'
import { beginAllowed, isBeginKey } from './controls'

describe('Begin keys', () => {
  it.each(['Enter', 'NumpadEnter', 'Space'])('%s starts the countdown', (code) => {
    expect(isBeginKey(code, false, { tagName: 'BODY' })).toBe(true)
    expect(isBeginKey(code, false, { tagName: 'BUTTON' })).toBe(true)
  })

  it('ignores other keys and auto-repeat', () => {
    expect(isBeginKey('KeyW', false, null)).toBe(false)
    expect(isBeginKey('Enter', true, null)).toBe(false)
  })

  it('does not fire while the name-entry input has focus', () => {
    expect(isBeginKey('Enter', false, { tagName: 'INPUT', type: 'text' })).toBe(false)
    expect(isBeginKey('Space', false, { tagName: 'INPUT' })).toBe(false)
    expect(isBeginKey('Enter', false, { tagName: 'TEXTAREA' })).toBe(false)
  })

  it('still fires with the volume slider focused', () => {
    expect(isBeginKey('Space', false, { tagName: 'INPUT', type: 'range' })).toBe(true)
  })
})

describe('beginAllowed', () => {
  it('refuses Begin while paused or flying, so Space in fly mode only rises', () => {
    expect(beginAllowed(false, false)).toBe(true)
    expect(beginAllowed(true, false)).toBe(false)
    expect(beginAllowed(false, true)).toBe(false)
    expect(beginAllowed(true, true)).toBe(false)
  })
})
