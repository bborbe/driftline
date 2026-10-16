// Best lap time and top-10 leaderboard in localStorage (same pattern as bborbe/snake).

export const MAX_LEADERBOARD_ENTRIES = 10

const BEST_KEY = 'driftline-best'
const BOARD_KEY = 'driftline-leaderboard'
const NAME_KEY = 'driftline-last-name'

export interface LeaderboardEntry {
  name: string
  lapTimeMs: number
}

/** The slice of the Web Storage API the store needs, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

export class RaceStore {
  private readonly storage: KeyValueStore

  constructor(storage: KeyValueStore) {
    this.storage = storage
  }

  best(): number | null {
    const v = Number(this.storage.getItem(BEST_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  }

  /** Records a finished lap; returns true when it beats the stored best. */
  recordLap(lapTimeMs: number): boolean {
    const best = this.best()
    if (best !== null && lapTimeMs >= best) return false
    this.storage.setItem(BEST_KEY, String(lapTimeMs))
    return true
  }

  leaderboard(): LeaderboardEntry[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(BOARD_KEY) ?? '[]')
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
    this.storage.setItem(BOARD_KEY, JSON.stringify(trimmed))
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
