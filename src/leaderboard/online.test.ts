import { describe, expect, it } from 'vitest'
import { createCar, type CarInput } from '../physics'
import type { GhostRun } from '../ghost/ghost'
import type { Fetch } from './client'
import { createOnline, type OnlineOptions } from './online'

const CFG = { url: 'https://lb.test/api/1.0' }
const ROWS = [{ id: 1, name: 'BEN', totalTicks: 300, checkpointTicks: [120], createdAt: '2026-10-18T00:00:00Z' }]
const steady: CarInput = { throttle: 1, brake: 0, steer: 0, handbrake: false }
const lap = (startTick: number, ticks: number): GhostRun => ({ start: { ...createCar(), tick: startTick }, inputs: Array(ticks).fill(steady), lapTimeMs: ticks * 10 })
// Lets the fire-and-forget requests (and their one retry) settle.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const memory = (name = ''): OnlineOptions['storage'] => {
  const m = new Map<string, string>(name ? [['driftline-last-name', name]] : [])
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

// A fake server: GET answers `board` (404 when null), POST answers 201; every call is logged.
const server = (board: unknown[] | null = ROWS) => {
  const posts: Record<string, unknown>[] = []
  const gets: string[] = []
  const fetchFn: Fetch = async (url, init) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body as string))
      return new Response('{"id":1,"best":true}', { status: 201 })
    }
    gets.push(url)
    return board ? new Response(JSON.stringify(board), { status: 200 }) : new Response('{}', { status: 404 })
  }
  return { posts, gets, fetchFn }
}

// Drives one lap's events: lapStart at `start`, checkpoints at the given absolute ticks, then the recorder keeps it.
const drive = (online: ReturnType<typeof createOnline>, start: number, cps: number[], ticks: number) => {
  const l = online.listener()
  l.lapStart?.(start, 1)
  cps.forEach((t, i) => l.checkpoint?.(t, i))
  online.lapKept(lap(start, ticks))
}

describe('online leaderboard', () => {
  it('loads the board, submits a finished lap with splits from the lap start, then reloads', async () => {
    const s = server()
    const online = createOnline(CFG, 'test1', { storage: memory('Ben'), laps: () => 1, fetch: s.fetchFn })
    let changes = 0
    online.onChange = () => changes++
    expect(online.board()).toEqual({ state: 'loading' })
    await flush()
    expect(online.board()).toEqual({ state: 'rows', rows: ROWS })
    drive(online, 500, [620], 300)
    await flush()
    expect(s.posts).toHaveLength(1)
    expect(s.posts[0]).toMatchObject({ name: 'BEN', track: 'test1', totalTicks: 300, checkpointTicks: [120] })
    expect(s.gets).toHaveLength(2)
    expect(online.note()).toBe('')
    expect(changes).toBeGreaterThanOrEqual(3)
  })

  it('a run finished with no name waits for one, then submits under the sanitised name', async () => {
    const s = server()
    const storage = memory()
    const online = createOnline(CFG, 'test1', { storage, laps: () => 1, fetch: s.fetchFn })
    await flush()
    drive(online, 0, [120], 300)
    await flush()
    expect(s.posts).toHaveLength(0)
    expect(online.needsName()).toBe(true)
    online.setName('  !!  ')
    expect(online.needsName()).toBe(true)
    online.setName('ace driver!')
    await flush()
    expect(online.needsName()).toBe(false)
    expect(s.posts[0].name).toBe('ACE DRIVER')
    expect(storage.getItem('driftline-last-name')).toBe('ACE DRIVER')
  })

  it('a track the server does not rank has no board and submits nothing', async () => {
    const s = server(null)
    const online = createOnline(CFG, 'test-kit', { storage: memory('Ben'), laps: () => 1, fetch: s.fetchFn })
    await flush()
    expect(online.board()).toBeNull()
    drive(online, 0, [120], 300)
    await flush()
    expect(s.posts).toHaveLength(0)
  })

  it('a lap kept before the first board answer waits for it: no submit when the track turns out unranked', async () => {
    let answer: (r: Response) => void = () => {}
    const posts: unknown[] = []
    const fetchFn: Fetch = (_url, init) => {
      if (init?.method === 'POST') return (posts.push(init.body), Promise.resolve(new Response('{}', { status: 201 })))
      return new Promise((resolve) => (answer = resolve))
    }
    const online = createOnline(CFG, 'test-kit', { storage: memory('Ben'), laps: () => 1, fetch: fetchFn })
    drive(online, 0, [120], 300)
    await flush()
    expect(posts).toHaveLength(0)
    answer(new Response('{}', { status: 404 }))
    await flush()
    expect(online.board()).toBeNull()
    expect(posts).toHaveLength(0)
  })

  it('a lap kept before the first board answer is submitted once the track proves ranked', async () => {
    let answer: (r: Response) => void = () => {}
    const posts: unknown[] = []
    const fetchFn: Fetch = (_url, init) => {
      if (init?.method === 'POST') return (posts.push(init.body), Promise.resolve(new Response('{}', { status: 201 })))
      return new Promise((resolve) => (answer = resolve))
    }
    const online = createOnline(CFG, 'test1', { storage: memory('Ben'), laps: () => 1, fetch: fetchFn })
    drive(online, 0, [120], 300)
    await flush()
    expect(posts).toHaveLength(0)
    answer(new Response(JSON.stringify(ROWS), { status: 200 }))
    await flush()
    expect(posts).toHaveLength(1)
  })

  it('a multi-lap run has no board and submits nothing', async () => {
    const s = server()
    const online = createOnline(CFG, 'test1', { storage: memory('Ben'), laps: () => 3, fetch: s.fetchFn })
    await flush()
    expect(online.board()).toBeNull()
    drive(online, 0, [120], 300)
    await flush()
    expect(s.posts).toHaveLength(0)
  })

  it('offline: skips the submit without a request and says so', async () => {
    const s = server()
    const online = createOnline(CFG, 'test1', { storage: memory('Ben'), laps: () => 1, fetch: s.fetchFn, online: () => false })
    await flush()
    drive(online, 0, [120], 300)
    await flush()
    expect(s.posts).toHaveLength(0)
    expect(online.note()).toBe('offline')
  })

  it('an unreachable server reads offline and keeps no board rows', async () => {
    const online = createOnline(CFG, 'test1', { storage: memory('Ben'), laps: () => 1, fetch: async () => Promise.reject(new TypeError('down')) })
    await flush()
    expect(online.board()).toEqual({ state: 'offline' })
    drive(online, 0, [120], 300)
    await flush()
    expect(online.note()).toBe('offline')
  })
})
