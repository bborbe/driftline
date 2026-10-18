import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  assign,
  BINDINGS_EVENT,
  clearSlot,
  conflicts,
  DEFAULT_BINDINGS,
  keyLabel,
  keysLabel,
  loadBindings,
  RESERVED,
  resetBindings,
  saveBindings,
  type Bindings,
} from './bindings'
import { KeyboardInput } from './input'
import { CONTROLS, controlsFor } from './race/controls'

const fake = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

/** A window stand-in: KeyboardInput only listens for events. */
const fakeWindow = () => {
  const target = new EventTarget()
  const key = (type: 'keydown' | 'keyup', code: string) => target.dispatchEvent(Object.assign(new Event(type), { code }))
  return { win: target as unknown as Window, down: (c: string) => key('keydown', c), up: (c: string) => key('keyup', c), target }
}

describe('default bindings', () => {
  it('are the keys the game shipped with, none reserved, no clash', () => {
    expect(DEFAULT_BINDINGS.throttle).toEqual(['KeyW', 'ArrowUp'])
    expect(DEFAULT_BINDINGS.handbrake).toEqual(['Space', null])
    expect(DEFAULT_BINDINGS.respawn).toEqual(['KeyR', null])
    expect(DEFAULT_BINDINGS.restart).toEqual(['Backspace', null])
    for (const a of ACTIONS) for (const c of DEFAULT_BINDINGS[a]) if (c) expect(RESERVED.has(c)).toBe(false)
    expect(conflicts(DEFAULT_BINDINGS).size).toBe(0)
  })
  it('keep the controls help list as it was', () => {
    const keys = CONTROLS.flatMap((g) => g.bindings.map((b) => b.keys))
    expect(keys).toEqual(expect.arrayContaining(['W / ↑', 'S / ↓', 'A D / ← →', 'Space', 'R', 'Backspace']))
  })
})

describe('rebinding', () => {
  it('drives throttle with the new key and no longer with the old one', () => {
    const r = assign(DEFAULT_BINDINGS, { action: 'throttle', index: 0 }, 'KeyI')
    if (!r.ok) throw new Error('KeyI is free')
    const w = fakeWindow()
    const input = new KeyboardInput(w.win, r.bindings)
    w.down('KeyW')
    expect(input.read().throttle).toBe(0)
    w.up('KeyW')
    w.down('KeyI')
    expect(input.read().throttle).toBe(1)
    w.up('KeyI')
    w.down('ArrowUp') // the secondary stays
    expect(input.read().throttle).toBe(1)
  })
  it('takes a bindings change live through BINDINGS_EVENT', () => {
    const w = fakeWindow()
    const input = new KeyboardInput(w.win, DEFAULT_BINDINGS)
    const r = assign(DEFAULT_BINDINGS, { action: 'handbrake', index: 0 }, 'ShiftLeft')
    if (!r.ok) throw new Error('ShiftLeft is free')
    w.target.dispatchEvent(new CustomEvent(BINDINGS_EVENT, { detail: r.bindings }))
    w.down('Space')
    expect(input.read().handbrake).toBe(false)
    w.down('ShiftLeft')
    expect(input.read().handbrake).toBe(true)
  })
  it('offers a swap for a key another action holds, naming that action; the swap gives it the old key', () => {
    const r = assign(DEFAULT_BINDINGS, { action: 'brake', index: 0 }, 'Space')
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'taken') throw new Error('Space is the handbrake')
    expect(r.by).toEqual({ action: 'handbrake', index: 0 })
    expect(r.swap.brake).toEqual(['Space', 'ArrowDown'])
    expect(r.swap.handbrake).toEqual(['KeyS', null])
    expect(conflicts(r.swap).size).toBe(0)
  })
  it('refuses the keys the shell owns', () => {
    for (const code of ['Escape', 'Backquote', 'KeyQ', 'KeyE', 'KeyH']) expect(assign(DEFAULT_BINDINGS, { action: 'throttle', index: 0 }, code)).toEqual({ ok: false, reason: 'reserved' })
  })
  it('moves a key between an action’s own two slots without a clash', () => {
    const r = assign(DEFAULT_BINDINGS, { action: 'throttle', index: 1 }, 'KeyW')
    if (!r.ok && r.reason === 'reserved') throw new Error('not reserved')
    const next = r.ok ? r.bindings : r.swap
    expect(next.throttle.filter((c) => c === 'KeyW')).toHaveLength(1)
  })
  it('reports both actions of a clash', () => {
    const b: Bindings = { ...DEFAULT_BINDINGS, brake: ['Space', null] }
    expect([...conflicts(b)].sort()).toEqual(['brake', 'handbrake'])
  })
  it('clears a secondary but never an action’s last key', () => {
    expect(clearSlot(DEFAULT_BINDINGS, { action: 'throttle', index: 1 }).throttle).toEqual(['KeyW', null])
    expect(clearSlot(DEFAULT_BINDINGS, { action: 'handbrake', index: 0 }).handbrake).toEqual(['Space', null])
  })
  it('resets one row or all of them to the defaults', () => {
    const r = assign(DEFAULT_BINDINGS, { action: 'throttle', index: 0 }, 'KeyI')
    const r2 = r.ok ? assign(r.bindings, { action: 'respawn', index: 0 }, 'KeyT') : r
    if (!r2.ok) throw new Error('free keys')
    const one = resetBindings(r2.bindings, 'throttle')
    expect(one.throttle).toEqual(DEFAULT_BINDINGS.throttle)
    expect(one.respawn).toEqual(['KeyT', null])
    expect(resetBindings(r2.bindings)).toEqual(DEFAULT_BINDINGS)
  })
})

describe('stored bindings', () => {
  it('round-trip, and fall back per action on garbage or a reserved key', () => {
    const s = fake()
    expect(loadBindings(s)).toEqual(DEFAULT_BINDINGS)
    const r = assign(DEFAULT_BINDINGS, { action: 'left', index: 0 }, 'KeyJ')
    if (!r.ok) throw new Error('KeyJ is free')
    saveBindings(s, r.bindings)
    expect(loadBindings(s)).toEqual(r.bindings)
    s.setItem('driftline-bindings', JSON.stringify({ throttle: ['Escape', null], brake: [null, null], left: 'KeyJ', right: ['KeyL2', 'ArrowRight'] }))
    const b = loadBindings(s)
    expect(b.throttle).toEqual(DEFAULT_BINDINGS.throttle)
    expect(b.brake).toEqual(DEFAULT_BINDINGS.brake)
    expect(b.left).toEqual(DEFAULT_BINDINGS.left)
    expect(b.right).toEqual(['KeyL2', 'ArrowRight'])
    s.setItem('driftline-bindings', '{nope')
    expect(loadBindings(s)).toEqual(DEFAULT_BINDINGS)
  })
})

describe('key labels', () => {
  it('shorten codes the way the help list writes them', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('ArrowLeft')).toBe('←')
    expect(keyLabel('Digit7')).toBe('7')
    expect(keyLabel('Numpad8')).toBe('Num 8')
    expect(keyLabel(null)).toBe('—')
    expect(keysLabel(DEFAULT_BINDINGS, 'brake')).toBe('S / ↓')
  })
  it('show rebound keys in the controls help', () => {
    const r = assign(DEFAULT_BINDINGS, { action: 'respawn', index: 0 }, 'KeyT')
    if (!r.ok) throw new Error('KeyT is free')
    const race = controlsFor(r.bindings).find((g) => g.title === 'Race')!
    expect(race.bindings.find((x) => x.action.startsWith('Respawn'))!.keys).toBe('T')
  })
})
