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

describe('RaceStore per lap count', () => {
  it('a 3-lap run keeps its own best and board; 1-lap records and keys are untouched', () => {
    const mem = memory()
    mem.data.set('driftline-best', '30000')
    const three = new RaceStore(mem, 'lap1', 'cccc0003', 3)
    expect(three.best()).toBeNull()
    expect(three.recordLap(95000)).toBe(true)
    three.addToLeaderboard('ben', 95000)
    expect(mem.data.get('driftline-best-laps3')).toBe('95000')
    expect(new RaceStore(mem, 'lap1', 'cccc0003').best()).toBe(30000)
    expect(new RaceStore(mem, 'lap1', 'cccc0003').leaderboard()).toEqual([])
    new RaceStore(mem, 'lap2', 'aaaa0001', 2).recordLap(80000)
    expect(mem.data.get('driftline-best-lap2-aaaa0001-laps2')).toBe('80000')
    expect(new RaceStore(mem, 'lap2', 'aaaa0001').best()).toBeNull()
    expect(new RaceStore(mem, 'lap2', 'aaaa0001', 1).best()).toBeNull() // laps=1 is the unsuffixed key
  })
})

describe('formatLapTime', () => {
  it('formats m:ss.mmm', () => expect(formatLapTime(83456)).toBe('1:23.456'))
})

describe('RaceStore splits and medal', () => {
  it('persists the best lap splits per track and layout', () => {
    const mem = memory()
    const store = new RaceStore(mem, 'lap2', 'abc')
    expect(store.bestSplits()).toBeNull()
    store.recordSplits([1000, 2500])
    expect(new RaceStore(mem, 'lap2', 'abc').bestSplits()).toEqual([1000, 2500])
    expect(new RaceStore(mem, 'lap2', 'other').bestSplits()).toBeNull()
  })

  it('keeps only the best medal across reloads', () => {
    const mem = memory()
    const store = new RaceStore(mem, 'lap2', 'abc')
    expect(store.bestMedal()).toBeNull()
    expect(store.recordMedal(null)).toBe(false)
    expect(store.recordMedal('silver')).toBe(true)
    expect(store.recordMedal('bronze')).toBe(false)
    expect(new RaceStore(mem, 'lap2', 'abc').bestMedal()).toBe('silver')
    expect(store.recordMedal('author')).toBe(true)
    expect(new RaceStore(mem, 'lap2', 'abc').bestMedal()).toBe('author')
  })
  it('renamed test1/test2 keep the records stored under lap1/lap2', () => {
    const mem = new Map<string, string>()
    const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    new RaceStore(fake, 'lap1', 'cccc0003').recordLap(30000)
    new RaceStore(fake, 'lap2', 'aaaa0001').recordLap(50000)
    new RaceStore(fake, 'lap2', 'aaaa0001', 3).recordLap(150000)
    expect(new RaceStore(fake, 'test1', 'cccc0003').best()).toBe(30000)
    expect(new RaceStore(fake, 'test2', 'aaaa0001').best()).toBe(50000)
    expect(new RaceStore(fake, 'test2', 'aaaa0001', 3).best()).toBe(150000)
    expect(mem.has('driftline-best')).toBe(true)
    expect(mem.has('driftline-best-lap2-aaaa0001')).toBe(true)
  })

})

describe('RaceStore locked (dev-tuned run)', () => {
  it('records no best, splits, medal or board entry while locked', () => {
    const mem = memory()
    let locked = true
    const store = new RaceStore(mem, 'test-flat', 'abc', 1, () => locked)
    expect(store.recordLap(30000)).toBe(false)
    store.recordSplits([1000, 2000])
    expect(store.recordMedal('gold')).toBe(false)
    expect(store.qualifies(30000)).toBe(false)
    expect(store.addToLeaderboard('dev', 30000)).toEqual([])
    expect(mem.data.size).toBe(0)
    locked = false
    expect(store.recordLap(30000)).toBe(true)
    expect(store.best()).toBe(30000)
  })
})
