import { describe, expect, it } from 'vitest'
import { CONTROLS, isControlsKey, isDebugKey } from './controls'

const allKeys = CONTROLS.flatMap((g) => g.bindings.map((b) => b.keys)).join(' | ')

describe('CONTROLS', () => {
  it('groups Driving, Race, Camera, Gamepad, Debug in that order, none empty', () => {
    expect(CONTROLS.map((g) => g.title)).toEqual(['Driving', 'Race', 'Camera', 'Gamepad', 'Debug'])
    for (const g of CONTROLS) expect(g.bindings.length).toBeGreaterThan(0)
  })

  // Every key the game binds (input.ts, race/index.ts, audio/controls.ts, camera/views.ts, camera/fly.ts, main.ts).
  it.each(['W', 'S', 'A D', 'Space', 'Enter', 'R', 'Backspace', 'Esc', 'L', 'T', 'F', 'M', 'H', '1 / 2 / 3', 'C', 'Space / Ctrl', 'E / Q', 'Shift', 'O', '`', 'P', 'F2'])(
    'lists %s',
    (key) => {
      expect(allKeys).toContain(key)
    },
  )
})

describe('gamepad group', () => {
  const pad = CONTROLS.find((g) => g.title === 'Gamepad')!.bindings.map((b) => `${b.keys}: ${b.action}`).join(' | ')

  // Every pad binding (src/gamepad.ts PAD_DRIVE + PAD_BINDINGS).
  it.each(['Left stick: Steer', 'RT: Accelerate', 'LT: Brake', 'A / LB: Handbrake', 'B: Respawn', 'Y: Restart', 'MENU', 'View: Next camera', 'D-pad / left stick: Menus'])(
    'lists %s',
    (row) => {
      expect(pad.toLowerCase()).toContain(row.toLowerCase())
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
