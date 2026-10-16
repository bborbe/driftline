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

describe('RaceStore per track', () => {
  it('keeps lap2 best and board apart from lap1, which keeps its original keys', () => {
    const mem = memory()
    mem.data.set('driftline-best', '30000') // a lap1 best saved before tracks were keyed
    const lap1 = new RaceStore(mem, 'lap1')
    const lap2 = new RaceStore(mem, 'lap2')
    expect(lap1.best()).toBe(30000)
    expect(lap2.best()).toBeNull()
    expect(lap2.recordLap(50000)).toBe(true)
    lap2.addToLeaderboard('ben', 50000)
    expect(mem.data.get('driftline-best')).toBe('30000')
    expect(new RaceStore(mem, 'lap1').best()).toBe(30000)
    expect(new RaceStore(mem, 'lap1').leaderboard()).toEqual([])
    expect(new RaceStore(mem, 'lap2').best()).toBe(50000)
    expect(new RaceStore(mem, 'lap2').leaderboard()).toEqual([{ name: 'BEN', lapTimeMs: 50000 }])
    expect(new RaceStore(mem).best()).toBe(30000) // default is lap1
  })
})

describe('RaceStore per layout', () => {
  it('a redesigned lap2 starts a fresh board; lap1 ignores the layout and keeps its keys', () => {
    const mem = memory()
    new RaceStore(mem, 'lap2', 'aaaa0001').recordLap(36050)
    expect(new RaceStore(mem, 'lap2', 'aaaa0001').best()).toBe(36050)
    expect(new RaceStore(mem, 'lap2', 'bbbb0002').best()).toBeNull()
    new RaceStore(mem, 'lap1', 'cccc0003').recordLap(20000)
    expect(mem.data.get('driftline-best')).toBe('20000')
  })
})

describe('formatLapTime', () => {
  it('formats m:ss.mmm', () => expect(formatLapTime(83456)).toBe('1:23.456'))
})
