// Keyboard focus over a vertical or horizontal list of menu items. Pure and tested.

/** Index after a key press: arrows move with wrap-around, anything else keeps it. */
export function moveFocus(index: number, count: number, code: string): number {
  if (count === 0) return 0
  if (code === 'ArrowDown' || code === 'ArrowRight' || code === 'KeyS' || code === 'KeyD') return (index + 1) % count
  if (code === 'ArrowUp' || code === 'ArrowLeft' || code === 'KeyW' || code === 'KeyA') return (index - 1 + count) % count
  return index
}

export const isSelectKey = (code: string): boolean => code === 'Enter' || code === 'NumpadEnter' || code === 'Space'
