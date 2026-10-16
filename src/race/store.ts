// Best lap time and top-10 leaderboard in localStorage (same pattern as bborbe/snake).

export const MAX_LEADERBOARD_ENTRIES = 10

const NAME_KEY = 'driftline-last-name'
/** lap1 keeps the original unsuffixed keys so existing best times and boards survive. */
const LEGACY_TRACK = 'lap1'
// Other tracks are keyed by name and layout, so a redesigned track starts a fresh board.
const suffix = (track: string, layout: string) =>
  track === LEGACY_TRACK ? '' : layout ? `-${track}-${layout}` : `-${track}`

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

  /** Best time and leaderboard are kept per track and layout (see layoutId); the last player name is shared. */
  constructor(storage: KeyValueStore, track: string = LEGACY_TRACK, layout = '') {
    this.storage = storage
    this.bestKey = `driftline-best${suffix(track, layout)}`
    this.boardKey = `driftline-leaderboard${suffix(track, layout)}`
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
