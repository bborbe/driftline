// Key bindings: which KeyboardEvent.code drives each rebindable action (Settings → Controls), persisted in
// localStorage, never in the URL (a player's own keys are not part of a shared setup). Every action has a
// primary and an optional secondary key; DEFAULT_BINDINGS follow Trackmania's layout (Backspace respawns, Delete
// restarts; R stays a secondary respawn key). Saved bindings are never rewritten when the defaults change. Pure and tested.

/** Storage this module reads and writes (localStorage in the game, a Map-backed stub in tests). */
type Store = Pick<Storage, 'getItem' | 'setItem'>

export const ACTIONS = ['throttle', 'brake', 'left', 'right', 'handbrake', 'respawn', 'restart'] as const
export type Action = (typeof ACTIONS)[number]

export const ACTION_LABELS: Record<Action, string> = {
  throttle: 'Accelerate',
  brake: 'Brake / reverse',
  left: 'Steer left',
  right: 'Steer right',
  handbrake: 'Handbrake',
  respawn: 'Respawn',
  restart: 'Restart the run',
}

/** One action's keys: primary, then secondary (null: none). */
export type Keys = [string | null, string | null]
export type Bindings = Record<Action, Keys>

export const DEFAULT_BINDINGS: Bindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space', null],
  respawn: ['Backspace', 'KeyR'],
  restart: ['Delete', null],
}

/**
 * Keys no action may take, because the shell owns them: Esc (pause, closes the panel), backtick (debug overlay),
 * Q / E (settings tab switch), H (controls help), F (fullscreen), M (mute), L (leaderboard), C / O (free-fly, orbit),
 * P (copy view), T (records panel), 1 / 2 / 3 (camera views), F2 (tuning), Tab (focus), Enter (start).
 */
export const RESERVED = new Set(['Escape', 'Backquote', 'KeyQ', 'KeyE', 'KeyH', 'KeyF', 'KeyM', 'KeyL', 'KeyC', 'KeyO', 'KeyP', 'KeyT', 'Digit1', 'Digit2', 'Digit3', 'F2', 'Tab', 'Enter', 'NumpadEnter'])

export const cloneBindings = (b: Bindings): Bindings => Object.fromEntries(ACTIONS.map((a) => [a, [...b[a]]])) as Bindings

const KEY = 'driftline-bindings'

const validCode = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 32 && !RESERVED.has(v)

/** Stored bindings; a missing action, a reserved or malformed key falls back to that action's default. */
export function loadBindings(storage: Store): Bindings {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return cloneBindings(DEFAULT_BINDINGS)
    const out = cloneBindings(DEFAULT_BINDINGS)
    for (const a of ACTIONS) {
      const k = raw[a]
      if (!Array.isArray(k) || k.length !== 2) continue
      const [p, s] = k
      if ((p === null || validCode(p)) && (s === null || validCode(s)) && (p !== null || s !== null)) out[a] = [p, s]
    }
    return out
  } catch {
    return cloneBindings(DEFAULT_BINDINGS)
  }
}

export function saveBindings(storage: Store, b: Bindings): void {
  storage.setItem(KEY, JSON.stringify(b))
}

/** Window event fired after every bindings change; detail is the saved Bindings, which the running race reads at once. */
export const BINDINGS_EVENT = 'driftline:bindings'

/** A slot: action plus 0 (primary) or 1 (secondary). */
export type Slot = { action: Action; index: 0 | 1 }

/** Every slot a code is bound to. */
export const slotsOf = (b: Bindings, code: string): Slot[] =>
  ACTIONS.flatMap((action) => ([0, 1] as const).filter((index) => b[action][index] === code).map((index) => ({ action, index })))

/** Actions whose keys clash with another action's: the same code bound to two actions. Both are reported. */
export function conflicts(b: Bindings): Set<Action> {
  const out = new Set<Action>()
  const owner = new Map<string, Action>()
  for (const a of ACTIONS)
    for (const code of b[a]) {
      if (code === null) continue
      const o = owner.get(code)
      if (o && o !== a) out.add(o).add(a)
      else owner.set(code, a)
    }
  return out
}

export type AssignResult =
  /** Bound; nothing else had the key. */
  | { ok: true; bindings: Bindings }
  /** The key belongs to another slot; `swap` binds it here and gives that slot this slot's old key. */
  | { ok: false; reason: 'taken'; by: Slot; swap: Bindings }
  /** Esc, backtick, Q / E and the other shell keys cannot be bound. */
  | { ok: false; reason: 'reserved' }

/** Bind `code` to `slot`. A key another slot holds is offered as a swap instead of silently stealing it. */
export function assign(b: Bindings, slot: Slot, code: string): AssignResult {
  if (RESERVED.has(code)) return { ok: false, reason: 'reserved' }
  const by = slotsOf(b, code).find((s) => s.action !== slot.action || s.index !== slot.index)
  const next = cloneBindings(b)
  const old = next[slot.action][slot.index]
  next[slot.action][slot.index] = code
  if (!by) return { ok: true, bindings: dedupe(next, slot) }
  next[by.action][by.index] = old
  return { ok: false, reason: 'taken', by, swap: dedupe(next, slot) }
}

/** A key bound to both slots of one action keeps only the primary. */
const dedupe = (b: Bindings, slot: Slot): Bindings => {
  const [p, s] = b[slot.action]
  if (p !== null && p === s) b[slot.action][slot.index === 0 ? 1 : 0] = null
  return b
}

/** Clear a slot; an action keeps at least one key, so clearing its last one is refused (returns the bindings unchanged). */
export function clearSlot(b: Bindings, slot: Slot): Bindings {
  const next = cloneBindings(b)
  const other = next[slot.action][slot.index === 0 ? 1 : 0]
  if (other === null) return next
  next[slot.action][slot.index] = null
  return next
}

/** One action, or every action when omitted, back to DEFAULT_BINDINGS. */
export function resetBindings(b: Bindings, action?: Action): Bindings {
  const next = cloneBindings(b)
  for (const a of action ? [action] : ACTIONS) next[a] = [...DEFAULT_BINDINGS[a]]
  return next
}

/** Whether `code` is one of `action`'s keys. */
export const isBound = (b: Bindings, action: Action, code: string): boolean => b[action][0] === code || b[action][1] === code

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt',
  AltRight: 'R-Alt',
}

/** A code as a short key label: KeyW → W, Digit4 → 4, ArrowUp → ↑, Numpad8 → Num 8. */
export function keyLabel(code: string | null): string {
  if (code === null) return '—'
  if (NAMED[code]) return NAMED[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

/** An action's keys as help text: "W / ↑", or the one key. */
export const keysLabel = (b: Bindings, a: Action): string =>
  b[a]
    .filter((c): c is string => c !== null)
    .map(keyLabel)
    .join(' / ')
