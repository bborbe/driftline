// Controls help: every key the game binds, grouped the way Trackmania's Settings > Controls page lists them.
// One list feeds the Esc menu's Controls page and the in-race panel H toggles; the rebindable rows (src/bindings.ts)
// show the player's own keys. Data is pure and tested.
import { DEFAULT_BINDINGS, keyLabel, keysLabel, loadBindings, type Bindings } from '../bindings'
import { PAD, PAD_BINDINGS, PAD_DRIVE } from '../gamepad'

export interface Binding {
  keys: string
  action: string
}

export interface ControlGroup {
  title: string
  bindings: Binding[]
}

/** Steer as one row: the primary pair, then the secondary pair ("A D / ← →"). */
const steerLabel = (b: Bindings): string =>
  ([0, 1] as const)
    .map((i) => [b.left[i], b.right[i]].filter((c): c is string => c !== null).map(keyLabel).join(' '))
    .filter((t) => t !== '')
    .join(' / ')

/** The controls list with the rebindable rows showing `b`'s keys. */
export const controlsFor = (b: Bindings): ControlGroup[] => [
  {
    title: 'Driving',
    bindings: [
      { keys: keysLabel(b, 'throttle'), action: 'Accelerate' },
      { keys: keysLabel(b, 'brake'), action: 'Brake / reverse' },
      { keys: steerLabel(b), action: 'Steer' },
      { keys: keysLabel(b, 'handbrake'), action: 'Handbrake' },
    ],
  },
  {
    title: 'Race',
    bindings: [
      { keys: 'Enter / Space', action: 'Start' },
      { keys: keysLabel(b, 'respawn'), action: 'Respawn at last checkpoint' },
      { keys: keysLabel(b, 'restart'), action: 'Restart the run' },
      { keys: 'Esc', action: 'Pause menu' },
      { keys: 'L', action: 'Leaderboard' },
      { keys: 'T', action: 'Records panel (medals, PB, top 5)' },
      { keys: 'F', action: 'Fullscreen' },
      { keys: 'M', action: 'Mute' },
      { keys: 'H', action: 'Controls (this list)' },
    ],
  },
  {
    title: 'Camera',
    bindings: [
      { keys: '1 / 2 / 3', action: 'Close chase / far chase / in-car' },
      { keys: 'C', action: 'Free-fly camera on / off' },
      { keys: 'W A S D', action: 'Fly: move' },
      { keys: 'Mouse drag', action: 'Fly: look' },
      { keys: 'Space / Ctrl, E / Q', action: 'Fly: up / down' },
      { keys: 'Shift', action: 'Fly: fast' },
      { keys: 'O', action: 'Fly: orbit the track' },
    ],
  },
  {
    // Built from the gamepad tables (src/gamepad.ts), so the panel can never drift from what the pad does.
    title: 'Gamepad',
    bindings: gamepadBindings(),
  },
  {
    title: 'Debug',
    bindings: [
      { keys: '`', action: 'Debug overlay on / off (dev only: ?dev=1 or ?debug=1 starts it on)' },
      { keys: 'P', action: 'Copy this view as a URL' },
      { keys: 'F2', action: 'Handling tuning panel (?dev=1 only)' },
    ],
  },
]

/** The list with the shipped keys. */
export const CONTROLS: ControlGroup[] = controlsFor(DEFAULT_BINDINGS)

/** The gamepad rows: analog driving, then each button, the four d-pad directions folded into one row. */
function gamepadBindings(): Binding[] {
  const name = (b: number) => Object.entries(PAD).find(([, i]) => i === b)![0]
  const buttons = PAD_BINDINGS.filter((b) => !b.name.startsWith('D-pad')).map((b) => ({ keys: b.name, action: b.action }))
  return [
    { keys: 'Left stick', action: 'Steer (analog)' },
    { keys: name(PAD_DRIVE.throttle), action: 'Accelerate (analog)' },
    { keys: name(PAD_DRIVE.brake), action: 'Brake / reverse (analog)' },
    { keys: PAD_DRIVE.handbrake.map(name).join(' / '), action: 'Handbrake' },
    ...buttons,
    { keys: 'D-pad / left stick', action: 'Menus: move' },
    // A browser shows a pad to a page only after one of its buttons is pressed; a pad that never shows needs a reload.
    { keys: 'No "Controller connected"?', action: 'Press any button; still nothing: reload the page' },
  ]
}

/** H opens and closes the controls panel. */
export const isControlsKey = (code: string): boolean => code === 'KeyH'

/** Backtick toggles the debug overlay. */
export const isDebugKey = (code: string): boolean => code === 'Backquote'

/** The controls list as a DOM table, one section per group. */
export function controlsPanel(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'controls'
  for (const g of controlsFor(loadBindings(localStorage))) {
    const section = document.createElement('section')
    const h = document.createElement('h3')
    h.textContent = g.title
    section.append(h)
    for (const b of g.bindings) {
      const row = document.createElement('div')
      const k = document.createElement('kbd')
      k.textContent = b.keys
      const a = document.createElement('span')
      a.textContent = b.action
      row.append(k, a)
      section.append(row)
    }
    box.append(section)
  }
  return box
}
