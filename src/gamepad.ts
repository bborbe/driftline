// Gamepad → CarInput and menu keys (Gamepad API "standard" mapping: Xbox / PlayStation pads in Chrome and Safari).
// Driving is analog — left stick steers through a dead zone and a response curve, the triggers are throttle and brake —
// and feeds the same CarInput the keys do, so physics never knows which device drove. Every other button becomes the
// key it stands for (B = the respawn key, Y = the restart key, Menu = Esc, …), dispatched as a key press, so menus, pause
// and the race need no gamepad code. All bindings live in the tables below, the one place key rebinding can extend. Pure and tested;
// src/gamepad-shell.ts polls the pad and dispatches.
import type { CarInput } from './physics'

/** Standard-mapping button indices (https://w3c.github.io/gamepad/#remapping), Xbox names. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const

/** The part of a Gamepad this module reads (a real `Gamepad` fits; tests build plain objects). */
export interface PadSnapshot {
  readonly axes: readonly number[]
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[]
}

/** Left stick X, |x| below this reads as centred (worn sticks rest off zero). */
export const STEER_DEAD_ZONE = 0.12
/** Response curve exponent past the dead zone: > 1 gives finer control near centre, full lock at full stick. */
export const STEER_CURVE = 1.5
/** Trigger travel below this reads as released. */
export const TRIGGER_DEAD_ZONE = 0.05
/** Stick deflection that counts as a direction in menus. */
export const NAV_THRESHOLD = 0.5

/** Analog driving bindings. */
export const PAD_DRIVE = {
  steerAxis: 0,
  throttle: PAD.RT,
  brake: PAD.LT,
  handbrake: [PAD.A],
} as const

/**
 * What a button does: a key code to press, a rebindable action name from src/bindings.ts (`respawn`, `restart`: the
 * player's own key for it is pressed), or CYCLE_CAMERA (next of the 1 / 2 / 3 views).
 */
export type PadAction = string
export const CYCLE_CAMERA = 'cycleCamera'

export interface PadBinding {
  button: number
  /** Button name as the controls panel shows it. */
  name: string
  /** Pressed while driving. */
  race?: PadAction
  /** Pressed while a menu is up (start screen, Begin, Esc menu, results). */
  menu?: PadAction
  /** Controls-panel text. */
  action: string
}

/** Button → key, per context. Driving buttons (triggers, A handbrake) are in PAD_DRIVE. */
export const PAD_BINDINGS: PadBinding[] = [
  { button: PAD.A, name: 'A', menu: 'Enter', action: 'Menus: select / start' },
  { button: PAD.B, name: 'B', race: 'respawn', menu: 'Escape', action: 'Respawn at last checkpoint · menus: back' },
  { button: PAD.Y, name: 'Y', race: 'restart', action: 'Restart the run' },
  { button: PAD.MENU, name: 'Menu', race: 'Escape', menu: 'Escape', action: 'Pause menu' },
  { button: PAD.VIEW, name: 'View', race: CYCLE_CAMERA, action: 'Next camera view' },
  { button: PAD.UP, name: 'D-pad ↑', menu: 'ArrowUp', action: 'Menus: move' },
  { button: PAD.DOWN, name: 'D-pad ↓', menu: 'ArrowDown', action: 'Menus: move' },
  { button: PAD.LEFT, name: 'D-pad ←', menu: 'ArrowLeft', action: 'Menus: move' },
  { button: PAD.RIGHT, name: 'D-pad →', menu: 'ArrowRight', action: 'Menus: move' },
]

/** Rescale `v` so the dead zone reads 0 and full deflection reads ±1 (no jump at the dead-zone edge). */
export function deadZone(v: number, dz: number): number {
  const a = Math.abs(v)
  if (a <= dz) return 0
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz))
}

/** Stick X → steer: dead zone, then the response curve. */
export function steerFromStick(x: number): number {
  const d = deadZone(x, STEER_DEAD_ZONE)
  return Math.sign(d) * Math.abs(d) ** STEER_CURVE
}

const value = (pad: PadSnapshot, i: number): number => pad.buttons[i]?.value ?? 0
const pressed = (pad: PadSnapshot, i: number): boolean => pad.buttons[i]?.pressed ?? false

/** The pad's driving input. */
export function padInput(pad: PadSnapshot): CarInput {
  return {
    throttle: deadZone(value(pad, PAD_DRIVE.throttle), TRIGGER_DEAD_ZONE),
    brake: deadZone(value(pad, PAD_DRIVE.brake), TRIGGER_DEAD_ZONE),
    steer: steerFromStick(pad.axes[PAD_DRIVE.steerAxis] ?? 0),
    handbrake: PAD_DRIVE.handbrake.some((b) => pressed(pad, b)),
  }
}

/** True when the input asks the car for anything. */
export const isActive = (i: CarInput): boolean => i.throttle !== 0 || i.brake !== 0 || i.steer !== 0 || i.handbrake

const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false }

/**
 * Keyboard + gamepad: whichever device became active last drives; when it goes idle the other one, if active, takes
 * over. Each frame reads both devices fresh, so a released key or a disconnected pad never leaves an input stuck.
 */
export class InputMix {
  private keysWas = false
  private padWas = false
  private lead: 'keys' | 'pad' = 'keys'

  mix(keys: CarInput, pad: CarInput | null): CarInput {
    const k = isActive(keys)
    const p = pad !== null && isActive(pad)
    if (k && !this.keysWas) this.lead = 'keys'
    if (p && !this.padWas) this.lead = 'pad'
    this.keysWas = k
    this.padWas = p
    if (p && (this.lead === 'pad' || !k)) return pad!
    return k ? keys : IDLE
  }
}

export type PadContext = 'menu' | 'race'
type Dir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
const isDir = (a: PadAction | undefined): a is Dir => a === 'ArrowUp' || a === 'ArrowDown' || a === 'ArrowLeft' || a === 'ArrowRight'

/** Hold a menu direction this long before it repeats, then repeat at this interval (ms). */
export const NAV_REPEAT_DELAY = 400
export const NAV_REPEAT_EVERY = 150

/** The menu direction the left stick points, or null inside NAV_THRESHOLD. */
export function stickDir(pad: PadSnapshot): Dir | null {
  const x = pad.axes[0] ?? 0
  const y = pad.axes[1] ?? 0
  if (Math.max(Math.abs(x), Math.abs(y)) < NAV_THRESHOLD) return null
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'ArrowRight' : 'ArrowLeft'
  return y > 0 ? 'ArrowDown' : 'ArrowUp'
}

/**
 * Button presses → key actions. A press fires once on its down edge; a menu direction (d-pad or stick) repeats while
 * held. Buttons already down when the pad first appears fire nothing.
 */
export class PadKeys {
  private was: boolean[] | null = null
  private held: { dir: Dir; next: number } | null = null

  update(pad: PadSnapshot | null, context: PadContext, nowMs: number): PadAction[] {
    if (!pad) {
      this.was = null
      this.held = null
      return []
    }
    const now = pad.buttons.map((b) => b.pressed)
    const was = this.was ?? now
    const first = this.was === null
    this.was = now
    const out: PadAction[] = []
    for (const b of PAD_BINDINGS) {
      const action = b[context]
      if (action && !isDir(action) && now[b.button] && !was[b.button]) out.push(action)
    }
    if (context !== 'menu') {
      this.held = null
      return out
    }
    const d = (PAD_BINDINGS.find((b) => isDir(b.menu) && now[b.button])?.menu as Dir | undefined) ?? stickDir(pad)
    if (!d) this.held = null
    else if (this.held?.dir !== d) {
      this.held = { dir: d, next: nowMs + NAV_REPEAT_DELAY }
      if (!first) out.push(d)
    } else if (nowMs >= this.held.next) {
      this.held.next = nowMs + NAV_REPEAT_EVERY
      out.push(d)
    }
    return out
  }
}

/** The pad to read: the first connected standard-mapping pad, else the first connected one. */
export function pickPad<T extends { connected: boolean; mapping: string }>(pads: readonly (T | null)[]): T | null {
  const live = pads.filter((p): p is T => !!p && p.connected)
  return live.find((p) => p.mapping === 'standard') ?? live[0] ?? null
}
