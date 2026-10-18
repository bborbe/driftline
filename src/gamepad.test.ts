import { describe, expect, it } from 'vitest'
import type { CarInput } from './physics'
import { ACTIONS } from './bindings'
import {
  CYCLE_CAMERA,
  deadZone,
  InputMix,
  NAV_REPEAT_DELAY,
  NAV_REPEAT_EVERY,
  PAD,
  PAD_BINDINGS,
  padInput,
  PadKeys,
  pickPad,
  STEER_DEAD_ZONE,
  steerFromStick,
  stickDir,
  type PadSnapshot,
} from './gamepad'
import { nextViewKey } from './gamepad-shell'

/** A standard-mapping pad: 17 buttons, 4 axes, everything at rest unless set. */
const pad = (o: { axes?: number[]; down?: number[]; values?: Record<number, number> } = {}): PadSnapshot => ({
  axes: o.axes ?? [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => {
    const value = o.values?.[i] ?? (o.down?.includes(i) ? 1 : 0)
    return { pressed: value > 0.5 || !!o.down?.includes(i), value }
  }),
})

const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false }

describe('mapping table', () => {
  it('maps the Xbox buttons to the keys they stand for', () => {
    const race = Object.fromEntries(PAD_BINDINGS.filter((b) => b.race).map((b) => [b.button, b.race]))
    expect(race).toEqual({ [PAD.B]: 'respawn', [PAD.Y]: 'restart', [PAD.MENU]: 'Escape', [PAD.VIEW]: CYCLE_CAMERA, [PAD.X]: 'KeyL' })
    const menu = Object.fromEntries(PAD_BINDINGS.filter((b) => b.menu).map((b) => [b.button, b.menu]))
    expect(menu).toEqual({
      [PAD.A]: 'Enter',
      [PAD.B]: 'Escape',
      [PAD.MENU]: 'Escape',
      [PAD.LB]: 'KeyQ',
      [PAD.RB]: 'KeyE',
      [PAD.UP]: 'ArrowUp',
      [PAD.DOWN]: 'ArrowDown',
      [PAD.LEFT]: 'ArrowLeft',
      [PAD.RIGHT]: 'ArrowRight',
    })
  })

  it('names only real rebindable actions, so the pad follows the player keys', () => {
    for (const b of PAD_BINDINGS) for (const a of [b.race, b.menu]) if (a && !/^(Arrow|Enter|Escape|Key)/.test(a) && a !== CYCLE_CAMERA) expect(ACTIONS).toContain(a)
  })

  it('binds each button at most once', () => {
    const buttons = PAD_BINDINGS.map((b) => b.button)
    expect(new Set(buttons).size).toBe(buttons.length)
  })
})

describe('dead zone', () => {
  it('reads 0 inside the zone and ±1 at full deflection', () => {
    expect(deadZone(0.1, 0.12)).toBe(0)
    expect(deadZone(-0.12, 0.12)).toBe(0)
    expect(deadZone(1, 0.12)).toBe(1)
    expect(deadZone(-1, 0.12)).toBe(-1)
  })

  it('has no jump at the edge of the zone', () => {
    expect(deadZone(STEER_DEAD_ZONE + 1e-6, STEER_DEAD_ZONE)).toBeLessThan(1e-5)
  })

  it('clamps an over-range axis', () => {
    expect(deadZone(1.2, 0.12)).toBe(1)
  })
})

describe('analog → CarInput', () => {
  it('a resting pad asks for nothing', () => {
    expect(padInput(pad())).toEqual(IDLE)
  })

  it('stick drift inside the dead zone does not steer', () => {
    expect(padInput(pad({ axes: [0.1, -0.05, 0, 0] })).steer).toBe(0)
  })

  it('steers left negative, right positive, full stick full lock', () => {
    expect(padInput(pad({ axes: [-1, 0, 0, 0] })).steer).toBe(-1)
    expect(padInput(pad({ axes: [1, 0, 0, 0] })).steer).toBe(1)
  })

  it('the response curve is finer than linear near centre and monotonic', () => {
    const half = steerFromStick(0.5)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(deadZone(0.5, STEER_DEAD_ZONE))
    let prev = -Infinity
    for (let x = -1; x <= 1; x += 0.05) {
      const s = steerFromStick(x)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  it('RT is analog throttle, LT analog brake', () => {
    const i = padInput(pad({ values: { [PAD.RT]: 0.6, [PAD.LT]: 0.3 } }))
    expect(i.throttle).toBeCloseTo((0.6 - 0.05) / 0.95)
    expect(i.brake).toBeCloseTo((0.3 - 0.05) / 0.95)
  })

  it('A is the handbrake (Forza layout); the bumpers are free', () => {
    expect(padInput(pad({ down: [PAD.A] })).handbrake).toBe(true)
    expect(padInput(pad({ down: [PAD.LB] })).handbrake).toBe(false)
    expect(padInput(pad({ down: [PAD.RB] })).handbrake).toBe(false)
    expect(padInput(pad({ down: [PAD.X] })).handbrake).toBe(false)
  })
})

describe('keyboard + gamepad mix', () => {
  const gas: CarInput = { ...IDLE, throttle: 1 }
  const left: CarInput = { ...IDLE, steer: -1 }

  it('either device alone drives', () => {
    expect(new InputMix().mix(gas, null)).toBe(gas)
    expect(new InputMix().mix(IDLE, left)).toBe(left)
  })

  it('the device that became active last wins, and the other takes over when it lets go', () => {
    const m = new InputMix()
    expect(m.mix(gas, IDLE)).toBe(gas)
    expect(m.mix(gas, left)).toBe(left) // pad touched while the key is held
    expect(m.mix(gas, IDLE)).toBe(gas) // pad released: the held key drives again
    expect(m.mix(gas, left)).toBe(left)
    const steerRight: CarInput = { ...IDLE, steer: 1 }
    expect(m.mix(steerRight, left)).toBe(left) // still the pad: the key did not newly go active
    expect(m.mix(IDLE, left)).toBe(left)
    expect(m.mix(gas, left)).toBe(gas) // key pressed again
  })

  it('nothing sticks: both idle reads idle, and a pad that disconnects stops driving at once', () => {
    const m = new InputMix()
    expect(m.mix(IDLE, left)).toBe(left)
    expect(m.mix(IDLE, null)).toEqual(IDLE)
    expect(m.mix(IDLE, IDLE)).toEqual(IDLE)
  })
})

describe('button presses', () => {
  it('fire once on the down edge, by context', () => {
    const k = new PadKeys()
    expect(k.update(pad(), 'race', 0)).toEqual([])
    expect(k.update(pad({ down: [PAD.B] }), 'race', 16)).toEqual(['respawn'])
    expect(k.update(pad({ down: [PAD.B] }), 'race', 32)).toEqual([])
    expect(k.update(pad(), 'race', 48)).toEqual([])
    expect(k.update(pad({ down: [PAD.Y, PAD.VIEW] }), 'race', 64)).toEqual(['restart', CYCLE_CAMERA])
    expect(k.update(pad({ down: [PAD.B] }), 'menu', 80)).toEqual(['Escape'])
  })

  it('A starts in menus but presses nothing while racing (it is the handbrake there)', () => {
    const k = new PadKeys()
    k.update(pad(), 'race', 0)
    expect(k.update(pad({ down: [PAD.A] }), 'race', 16)).toEqual([])
    const m = new PadKeys()
    m.update(pad(), 'menu', 0)
    expect(m.update(pad({ down: [PAD.A] }), 'menu', 16)).toEqual(['Enter'])
  })

  // A browser shows a pad to the page only once a button is pressed after load, so the press that reveals it is the
  // player's first input (A on Begin after a track pick, the first d-pad step on the start screen) and must not be lost.
  it('the press that reveals the pad fires', () => {
    expect(new PadKeys().update(pad({ down: [PAD.A] }), 'menu', 0)).toEqual(['Enter'])
    expect(new PadKeys().update(pad({ down: [PAD.RIGHT] }), 'menu', 0)).toEqual(['ArrowRight'])
    expect(new PadKeys().update(pad({ down: [PAD.B] }), 'race', 0)).toEqual(['respawn'])
    const k = new PadKeys()
    k.update(pad({ down: [PAD.A] }), 'menu', 0)
    expect(k.update(pad({ down: [PAD.A] }), 'menu', 16)).toEqual([]) // still held: once only
  })

  it('a menu direction (d-pad or stick) repeats while held, and not in a race', () => {
    const k = new PadKeys()
    k.update(pad(), 'menu', 0)
    expect(k.update(pad({ down: [PAD.DOWN] }), 'menu', 10)).toEqual(['ArrowDown'])
    expect(k.update(pad({ down: [PAD.DOWN] }), 'menu', 10 + NAV_REPEAT_DELAY - 1)).toEqual([])
    expect(k.update(pad({ down: [PAD.DOWN] }), 'menu', 10 + NAV_REPEAT_DELAY)).toEqual(['ArrowDown'])
    expect(k.update(pad({ down: [PAD.DOWN] }), 'menu', 10 + NAV_REPEAT_DELAY + NAV_REPEAT_EVERY)).toEqual(['ArrowDown'])
    expect(k.update(pad({ axes: [0.9, 0.1, 0, 0] }), 'menu', 1000)).toEqual(['ArrowRight'])
    expect(k.update(pad({ axes: [0.9, 0.1, 0, 0] }), 'race', 2000)).toEqual([])
  })

  it('a disconnect forgets the held buttons', () => {
    const k = new PadKeys()
    k.update(pad(), 'race', 0)
    k.update(pad({ down: [PAD.B] }), 'race', 16)
    expect(k.update(null, 'race', 32)).toEqual([])
    expect(k.update(pad({ down: [PAD.B] }), 'race', 48)).toEqual(['respawn']) // a reconnect is revealed by a press too
    expect(k.update(pad({ down: [PAD.B] }), 'race', 64)).toEqual([])
  })
})

describe('stick direction', () => {
  it('needs half deflection and picks the dominant axis', () => {
    expect(stickDir(pad({ axes: [0.4, 0.3, 0, 0] }))).toBeNull()
    expect(stickDir(pad({ axes: [0.2, -0.8, 0, 0] }))).toBe('ArrowUp')
    expect(stickDir(pad({ axes: [-0.7, 0.6, 0, 0] }))).toBe('ArrowLeft')
  })
})

describe('pad choice and camera cycle', () => {
  it('prefers a connected standard-mapping pad', () => {
    const a = { id: 'a', connected: true, mapping: '' }
    const b = { id: 'b', connected: true, mapping: 'standard' }
    const c = { id: 'c', connected: false, mapping: 'standard' }
    expect(pickPad([null, c, a, b])).toBe(b)
    expect(pickPad([a])).toBe(a)
    expect(pickPad([null, c])).toBeNull()
  })

  it('View cycles close → far → in-car → close', () => {
    expect(nextViewKey('close')).toBe('Digit2')
    expect(nextViewKey('far')).toBe('Digit3')
    expect(nextViewKey('cockpit')).toBe('Digit1')
  })
})
