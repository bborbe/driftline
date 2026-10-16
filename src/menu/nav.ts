// Keyboard focus over a vertical or horizontal list of menu items. Pure and tested.

/** Index after a key press: arrows move with wrap-around, anything else keeps it. */
export function moveFocus(index: number, count: number, code: string): number {
  if (count === 0) return 0
  if (code === 'ArrowDown' || code === 'ArrowRight' || code === 'KeyS' || code === 'KeyD') return (index + 1) % count
  if (code === 'ArrowUp' || code === 'ArrowLeft' || code === 'KeyW' || code === 'KeyA') return (index - 1 + count) % count
  return index
}

export const isSelectKey = (code: string): boolean => code === 'Enter' || code === 'NumpadEnter' || code === 'Space'

/** A cell in a menu of rows of different lengths (track groups, then settings). */
export interface GridPos {
  row: number
  col: number
}

/** Cell after a key press: left/right move within the row, up/down change row (column clamped); all wrap. */
export function moveGrid(pos: GridPos, rows: number[], code: string): GridPos {
  if (rows.length === 0) return { row: 0, col: 0 }
  const row = (r: number) => ({ row: r, col: Math.min(pos.col, rows[r] - 1) })
  if (code === 'ArrowRight' || code === 'KeyD') return { row: pos.row, col: (pos.col + 1) % rows[pos.row] }
  if (code === 'ArrowLeft' || code === 'KeyA') return { row: pos.row, col: (pos.col - 1 + rows[pos.row]) % rows[pos.row] }
  if (code === 'ArrowDown' || code === 'KeyS') return row((pos.row + 1) % rows.length)
  if (code === 'ArrowUp' || code === 'KeyW') return row((pos.row - 1 + rows.length) % rows.length)
  return pos
}
