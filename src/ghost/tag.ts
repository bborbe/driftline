// Ghost name tags: which ghosts race (PB / Gold / Author) and the text each floating tag shows.
// Pure and tested; src/ghost/tags.ts only places the text on screen.
import { formatDelta } from '../race/medals'
import { formatLapTime } from '../race/store'

export type GhostKind = 'pb' | 'gold' | 'author'

/** Tag order, top to bottom when tags stack. */
export const GHOST_KINDS: readonly GhostKind[] = ['pb', 'gold', 'author']

export const GHOST_NAME: Record<GhostKind, string> = { pb: 'Personal best', gold: 'Gold', author: 'Author' }

/** Ghosts on by default: your own best and the gold pace. */
export const DEFAULT_GHOSTS: readonly GhostKind[] = ['pb', 'gold']

/** The known kinds in `v`, in GHOST_KINDS order, or null when `v` is not a list. */
export const clampGhosts = (v: unknown): GhostKind[] | null => (Array.isArray(v) ? GHOST_KINDS.filter((k) => v.includes(k)) : null)

/**
 * `?ghosts=`: a comma list of pb / gold / author, or `none` for no ghosts. Null (keep the stored choice) when the
 * key is missing or names nothing known.
 */
export function ghostsFromQuery(value: string | null): GhostKind[] | null {
  if (value === null) return null
  const parts = value.split(',').map((p) => p.trim())
  if (parts.includes('none')) return []
  const kinds = GHOST_KINDS.filter((k) => parts.includes(k))
  return kinds.length > 0 ? kinds : null
}

export const ghostsQuery = (kinds: readonly GhostKind[]): string => (kinds.length > 0 ? kinds.join(',') : 'none')

/**
 * The ghosts that race: the selected ones, with the medal ghosts only in a single-lap race (medals are single-lap
 * only) on a track with medals whose pace lap finished.
 */
export function offeredGhosts(selected: readonly GhostKind[], race: { medals: boolean; laps: number; paceLap: boolean }): GhostKind[] {
  const medal = race.medals && race.laps === 1 && race.paceLap
  return GHOST_KINDS.filter((k) => selected.includes(k) && (k === 'pb' || medal))
}

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
}

export interface TagText {
  name: string
  /** The ghost's finish time before the car's first checkpoint; after it, e.g. `2nd 0:09.562 +0.007`. */
  detail: string
  /** Ghost ahead of the car at the last point both passed; null before the car's first checkpoint. */
  ahead: boolean | null
}

/**
 * Tag text for one ghost. `ghostMs` is the ghost's time at the last checkpoint (or finish) the car passed, or its
 * finish time while the car has passed none (`carMs` null). `field` is every racer's time at that point (the car and
 * each ghost), for the ghost's place. The gap is car − ghost: `+` the car is behind this ghost, `-` ahead of it.
 * `name` replaces the kind's own (a challenge ghost carries the sender's name).
 */
export function tagText(kind: GhostKind, ghostMs: number, carMs: number | null, field: readonly number[] = [], name = GHOST_NAME[kind]): TagText {
  // Whole milliseconds first, so the printed gap is exactly the printed car time minus the printed ghost time.
  const ghost = Math.round(ghostMs)
  if (carMs === null) return { name, detail: formatLapTime(ghost), ahead: null }
  const place = 1 + field.filter((ms) => Math.round(ms) < ghost).length
  const gap = Math.round(carMs) - ghost
  return { name, detail: `${ordinal(place)} ${formatLapTime(ghost)} ${formatDelta(gap)}`, ahead: gap > 0 }
}

/**
 * A racer's time at the car's `passed`-th point this lap on a track with `checkpoints` gates: checkpoints 1..n,
 * then the finish line as point n+1. Null when the car has passed nothing yet or the racer has no time there.
 */
export function timeAtPoint(splits: readonly number[], lapMs: number, passed: number, checkpoints: number): number | null {
  if (passed <= 0 || passed > checkpoints + 1) return null
  return passed === checkpoints + 1 ? lapMs : (splits[passed - 1] ?? null)
}
