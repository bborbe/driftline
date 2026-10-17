import { describe, expect, it } from 'vitest'
import { CONTROLS, isControlsKey, isDebugKey } from './controls'

const allKeys = CONTROLS.flatMap((g) => g.bindings.map((b) => b.keys)).join(' | ')

describe('CONTROLS', () => {
  it('groups Driving, Race, Camera, Debug in that order, none empty', () => {
    expect(CONTROLS.map((g) => g.title)).toEqual(['Driving', 'Race', 'Camera', 'Debug'])
    for (const g of CONTROLS) expect(g.bindings.length).toBeGreaterThan(0)
  })

  // Every key the game binds (input.ts, race/index.ts, audio/controls.ts, camera/views.ts, camera/fly.ts, main.ts).
  it.each(['W', 'S', 'A D', 'Space', 'Enter', 'R', 'Backspace', 'Esc', 'L', 'F', 'M', 'H', '1 / 2 / 3', 'C', 'Space / Ctrl', 'E / Q', 'Shift', 'O', '`', 'P'])(
    'lists %s',
    (key) => {
      expect(allKeys).toContain(key)
    },
  )
})

describe('keys', () => {
  it('H is controls, backtick is debug, and they never overlap', () => {
    expect(isControlsKey('KeyH')).toBe(true)
    expect(isDebugKey('Backquote')).toBe(true)
    expect(isControlsKey('Backquote')).toBe(false)
    expect(isDebugKey('KeyH')).toBe(false)
  })
})
