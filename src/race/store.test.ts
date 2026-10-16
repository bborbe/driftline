import { describe, expect, it } from 'vitest'
import { formatLapTime, MAX_LEADERBOARD_ENTRIES, RaceStore, type KeyValueStore } from './store'

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('RaceStore best time', () => {
  it('stores the first lap and keeps the faster one', () => {
    const mem = memory()
    const store = new RaceStore(mem)
    expect(store.best()).toBeNull()
    expect(store.recordLap(42000)).toBe(true)
    expect(store.recordLap(45000)).toBe(false) // slower second run
    expect(new RaceStore(mem).best()).toBe(42000) // fresh instance = reload
    expect(store.recordLap(40000)).toBe(true)
    expect(new RaceStore(mem).best()).toBe(40000)
  })
})

describe('RaceStore leaderboard', () => {
  it('keeps the 10 fastest laps sorted ascending and drops the 11th', () => {
    const mem = memory()
    const store = new RaceStore(mem)
    for (let i = 11; i >= 1; i--) store.addToLeaderboard(`p${i}`, i * 1000)
    const board = new RaceStore(mem).leaderboard()
    expect(board).toHaveLength(MAX_LEADERBOARD_ENTRIES)
    expect(board.map((e) => e.lapTimeMs)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => n * 1000))
    expect(board.some((e) => e.lapTimeMs === 11000)).toBe(false)
    expect(board[0].name).toBe('P1')
  })

  it('qualifies only times that beat the 10th entry once full', () => {
    const store = new RaceStore(memory())
    for (let i = 1; i <= 10; i++) store.addToLeaderboard('x', i * 1000)
    expect(store.qualifies(10000)).toBe(false)
    expect(store.qualifies(9999)).toBe(true)
  })

  it('remembers the last player name across reloads', () => {
    const mem = memory()
    new RaceStore(mem).addToLeaderboard(' Ben ', 30000)
    expect(new RaceStore(mem).lastName()).toBe('Ben')
  })

  it('survives corrupt storage', () => {
    const mem = memory()
    mem.data.set('driftline-leaderboard', '{nope')
    expect(new RaceStore(mem).leaderboard()).toEqual([])
  })
})

describe('formatLapTime', () => {
  it('formats m:ss.mmm', () => expect(formatLapTime(83456)).toBe('1:23.456'))
})
