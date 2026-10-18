// Settings → Controls: one row per rebindable action (src/bindings.ts) with a primary and a secondary key, a
// reset per row and Reset all. Click a key, then press the new one: Esc cancels; right-click a key clears its slot
// (Delete is a game key, the default restart, so it binds like any other). A key another
// action holds marks both rows and offers Swap; a key the shell owns (Esc, Q / E, H …) is refused. Saves and fires
// BINDINGS_EVENT after every change, so the running race drives with the new keys at once.
import {
  ACTION_LABELS,
  ACTIONS,
  assign,
  BINDINGS_EVENT,
  clearSlot,
  conflicts,
  keyLabel,
  loadBindings,
  resetBindings,
  saveBindings,
  type Action,
  type Bindings,
  type Slot,
} from '../bindings'

const cell = (el: HTMLElement): HTMLTableCellElement => {
  const td = document.createElement('td')
  td.append(el)
  return td
}

export function bindingsTable(): HTMLElement {
  let b: Bindings = loadBindings(localStorage)
  const box = Object.assign(document.createElement('div'), { className: 'menu-span menu-bindings', id: 'setting-bindings' })
  const table = document.createElement('table')
  const toast = Object.assign(document.createElement('div'), { className: 'menu-toast', id: 'setting-bindings-toast', hidden: true })
  const resetAll = Object.assign(document.createElement('button'), { type: 'button', className: 'menu-link', textContent: 'Reset all to defaults', id: 'setting-bindings-reset' })
  box.append(table, toast, resetAll)

  const rows = {} as Record<Action, HTMLTableRowElement>
  const keys = {} as Record<Action, [HTMLButtonElement, HTMLButtonElement]>
  let listening: Slot | null = null
  let clash: Action[] = []

  const save = (next: Bindings) => {
    b = next
    saveBindings(localStorage, b)
    window.dispatchEvent(new CustomEvent(BINDINGS_EVENT, { detail: b }))
  }
  const say = (text: string, ...buttons: HTMLButtonElement[]) => {
    toast.replaceChildren(text, ...buttons)
    toast.hidden = false
  }
  const quiet = () => {
    toast.hidden = true
    clash = []
  }
  const render = () => {
    const bad = conflicts(b)
    for (const a of ACTIONS) {
      rows[a].classList.toggle('menu-clash', bad.has(a) || clash.includes(a))
      for (const i of [0, 1] as const) {
        const k = keys[a][i]
        const on = listening?.action === a && listening.index === i
        k.textContent = on ? 'press…' : keyLabel(b[a][i])
        k.classList.toggle('menu-key-listen', on)
        k.classList.toggle('menu-key-empty', !on && b[a][i] === null)
      }
    }
  }

  const stop = () => {
    listening = null
    delete document.body.dataset.keyCapture
    window.removeEventListener('keydown', onCapture, true)
  }
  // Capture phase, first: the pressed key must not also pause, respawn, switch tab or steer.
  const onCapture = (e: KeyboardEvent) => {
    if (!listening) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const slot = listening
    stop()
    if (e.code === 'Escape') return render()
    const r = assign(b, slot, e.code)
    if (r.ok) {
      save(r.bindings)
      quiet()
    } else if (r.reason === 'reserved') {
      quiet()
      say(`${keyLabel(e.code)} is reserved for the game.`)
    } else {
      clash = [slot.action, r.by.action]
      const swap = Object.assign(document.createElement('button'), { type: 'button', className: 'menu-link', textContent: 'Swap', id: 'setting-bindings-swap' })
      const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'menu-link', textContent: 'Cancel' })
      swap.addEventListener('click', (ev) => {
        ev.stopPropagation()
        save(r.swap)
        quiet()
        render()
      })
      cancel.addEventListener('click', (ev) => {
        ev.stopPropagation()
        quiet()
        render()
      })
      say(`${keyLabel(e.code)} is already on ${ACTION_LABELS[r.by.action]}.`, swap, cancel)
    }
    render()
  }

  for (const a of ACTIONS) {
    const tr = document.createElement('tr')
    tr.id = `setting-bind-${a}`
    const name = Object.assign(document.createElement('td'), { textContent: ACTION_LABELS[a] })
    const pair = ([0, 1] as const).map((i) => {
      const k = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'menu-key',
        id: `setting-bind-${a}-${i}`,
        title: 'Click, then press a key · right-click to clear',
      })
      k.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (listening) stop()
        save(clearSlot(b, { action: a, index: i }))
        quiet()
        render()
      })
      k.addEventListener('click', (e) => {
        e.stopPropagation()
        if (listening) stop()
        quiet()
        listening = { action: a, index: i }
        document.body.dataset.keyCapture = '1'
        window.addEventListener('keydown', onCapture, true)
        render()
      })
      return k
    }) as [HTMLButtonElement, HTMLButtonElement]
    keys[a] = pair
    const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'menu-link', textContent: '↺', title: 'Reset to default' })
    reset.addEventListener('click', (e) => {
      e.stopPropagation()
      save(resetBindings(b, a))
      quiet()
      render()
    })
    tr.append(name, ...pair.map(cell), cell(reset))
    rows[a] = tr
    table.append(tr)
  }
  resetAll.addEventListener('click', (e) => {
    e.stopPropagation()
    save(resetBindings(b))
    quiet()
    render()
  })
  render()
  return box
}
