// Pad focus over the settings panel's open tab: a menu key (the pad's d-pad / stick / A, or the matching keyboard keys)
// moves a focus ring between the page's controls, ←/→ adjust the focused select, slider or number, and A presses it.
// The pure part decides what a key does; src/menu/settings-panel.ts applies it to the DOM. Pure and tested.
import { isSelectKey, moveFocus } from './nav'

/** How a control takes ←/→ and A: an adjustable value, a text field, or a thing to press (button, checkbox, summary). */
export type PadKind = 'select' | 'range' | 'number' | 'text' | 'press'

const ADJUSTABLE: readonly PadKind[] = ['select', 'range', 'number']

/** The kind for a control's tag name and input type. */
export function padKind(tag: string, type = ''): PadKind {
  if (tag === 'SELECT') return 'select'
  if (tag !== 'INPUT') return 'press'
  if (type === 'range') return 'range'
  if (type === 'number') return 'number'
  if (type === 'checkbox' || type === 'radio') return 'press'
  return 'text'
}

export type PadMove = { type: 'focus'; index: number } | { type: 'adjust'; delta: -1 | 1 } | { type: 'activate' }

/**
 * What a key does with focus at `index` (null: nothing focused yet) over `count` controls, the focused one of `kind`.
 * ↑/↓ move (wrapping); ←/→ adjust an adjustable control and move otherwise; Enter / Space press. Null: not for us.
 */
export function padFocusKey(index: number | null, count: number, kind: PadKind | null, code: string): PadMove | null {
  if (count === 0) return null
  const arrow = code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight'
  if (index === null || index >= count) return arrow ? { type: 'focus', index: 0 } : null
  if (isSelectKey(code)) return { type: 'activate' }
  if (!arrow) return null
  const horizontal = code === 'ArrowLeft' || code === 'ArrowRight'
  if (horizontal && kind && ADJUSTABLE.includes(kind)) return { type: 'adjust', delta: code === 'ArrowRight' ? 1 : -1 }
  return { type: 'focus', index: moveFocus(index, count, code) }
}

/** A slider or number field one step on: clamped to [min, max], snapped to the step grid from min. */
export function nudge(value: number, min: number, max: number, step: number, delta: -1 | 1): number {
  const s = step > 0 ? step : 1
  const n = Math.round((value - min) / s) + delta
  return Math.min(max, Math.max(min, Number((min + n * s).toFixed(6))))
}

/** A select's option index one on: ←/→ stop at the ends, A (wrap) cycles. */
export function nextOption(index: number, count: number, delta: -1 | 1, wrap = false): number {
  if (count === 0) return index
  if (wrap) return (index + delta + count) % count
  return Math.min(count - 1, Math.max(0, index + delta))
}
