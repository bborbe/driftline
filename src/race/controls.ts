// Controls help: every key the game binds, grouped the way Trackmania's Settings > Controls page lists them.
// One list feeds the Esc menu's Controls page and the in-race panel H toggles. Data is pure and tested.

export interface Binding {
  keys: string
  action: string
}

export interface ControlGroup {
  title: string
  bindings: Binding[]
}

export const CONTROLS: ControlGroup[] = [
  {
    title: 'Driving',
    bindings: [
      { keys: 'W / ↑', action: 'Accelerate' },
      { keys: 'S / ↓', action: 'Brake / reverse' },
      { keys: 'A D / ← →', action: 'Steer' },
      { keys: 'Space', action: 'Handbrake' },
    ],
  },
  {
    title: 'Race',
    bindings: [
      { keys: 'Enter / Space', action: 'Start' },
      { keys: 'R', action: 'Respawn at last checkpoint' },
      { keys: 'Backspace', action: 'Restart the run' },
      { keys: 'Esc', action: 'Pause menu' },
      { keys: 'L', action: 'Leaderboard' },
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
    title: 'Debug',
    bindings: [
      { keys: '`', action: 'Debug overlay on / off (?debug=0 starts it off)' },
      { keys: 'P', action: 'Copy this view as a URL' },
      { keys: 'F2', action: 'Handling tuning panel (?dev=1 only)' },
    ],
  },
]

/** H opens and closes the controls panel. */
export const isControlsKey = (code: string): boolean => code === 'KeyH'

/** Backtick toggles the debug overlay. */
export const isDebugKey = (code: string): boolean => code === 'Backquote'

/** The controls list as a DOM table, one section per group. */
export function controlsPanel(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'controls'
  for (const g of CONTROLS) {
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
