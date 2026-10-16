// Best lap time, its checkpoint splits, best medal and top-10 leaderboard in localStorage (same pattern as bborbe/snake).
import { isBetterMedal, MEDAL_ORDER, type Medal } from './medals'

export const MAX_LEADERBOARD_ENTRIES = 10

const NAME_KEY = 'driftline-last-name'
/** lap1 keeps the original unsuffixed keys so existing best times and boards survive. */
const LEGACY_TRACK = 'lap1'
// Other tracks are keyed by name and layout, so a redesigned track starts a fresh board.
// Multi-lap runs get their own records: a 3-lap total never competes with 1-lap times.
const suffix = (track: string, layout: string, laps: number) =>
  (track === LEGACY_TRACK ? '' : layout ? `-${track}-${layout}` : `-${track}`) + (laps > 1 ? `-laps${laps}` : '')

export interface LeaderboardEntry {
  name: string
  lapTimeMs: number
}

/** The slice of the Web Storage API the store needs, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

export class RaceStore {
  private readonly storage: KeyValueStore
  private readonly bestKey: string
  private readonly boardKey: string
  private readonly splitsKey: string
  private readonly medalKey: string

  /** Best time and leaderboard are kept per track, layout (see layoutId) and lap count; the last player name is shared. */
  constructor(storage: KeyValueStore, track: string = LEGACY_TRACK, layout = '', laps = 1) {
    this.storage = storage
    this.bestKey = `driftline-best${suffix(track, layout, laps)}`
    this.boardKey = `driftline-leaderboard${suffix(track, layout, laps)}`
    this.splitsKey = `driftline-splits${suffix(track, layout, laps)}`
    this.medalKey = `driftline-medal${suffix(track, layout, laps)}`
  }

  best(): number | null {
    const v = Number(this.storage.getItem(this.bestKey))
    return Number.isFinite(v) && v > 0 ? v : null
  }

  /** Records a finished lap; returns true when it beats the stored best. */
  recordLap(lapTimeMs: number): boolean {
    const best = this.best()
    if (best !== null && lapTimeMs >= best) return false
    this.storage.setItem(this.bestKey, String(lapTimeMs))
    return true
  }

  /** Checkpoint lap times (ms) of the best lap, or null when none is stored. */
  bestSplits(): number[] | null {
    try {
      const parsed = JSON.parse(this.storage.getItem(this.splitsKey) ?? 'null')
      return Array.isArray(parsed) && parsed.every((v) => Number.isFinite(v)) ? parsed : null
    } catch {
      return null
    }
  }

  /** Call after recordLap returned true, with that lap's checkpoint times. */
  recordSplits(splits: number[]): void {
    this.storage.setItem(this.splitsKey, JSON.stringify(splits))
  }

  bestMedal(): Medal | null {
    const v = this.storage.getItem(this.medalKey)
    return MEDAL_ORDER.find((m) => m === v) ?? null
  }

  /** Keeps the better of the stored and the given medal; returns true when it improved. */
  recordMedal(medal: Medal | null): boolean {
    if (!isBetterMedal(medal, this.bestMedal())) return false
    this.storage.setItem(this.medalKey, medal as Medal)
    return true
  }

  leaderboard(): LeaderboardEntry[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(this.boardKey) ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  qualifies(lapTimeMs: number): boolean {
    const entries = this.leaderboard()
    return entries.length < MAX_LEADERBOARD_ENTRIES || lapTimeMs < entries[entries.length - 1].lapTimeMs
  }

  addToLeaderboard(name: string, lapTimeMs: number): LeaderboardEntry[] {
    const entries = [...this.leaderboard(), { name: name.trim().toUpperCase() || '???', lapTimeMs }]
    entries.sort((a, b) => a.lapTimeMs - b.lapTimeMs)
    const trimmed = entries.slice(0, MAX_LEADERBOARD_ENTRIES)
    this.storage.setItem(this.boardKey, JSON.stringify(trimmed))
    this.storage.setItem(NAME_KEY, name.trim())
    return trimmed
  }

  lastName(): string {
    return this.storage.getItem(NAME_KEY) ?? ''
  }
}

export const formatLapTime = (ms: number): string => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`
}
