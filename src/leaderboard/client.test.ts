import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCar, type CarInput } from '../physics'
import type { GhostRun } from '../ghost/ghost'
import { fetchBoard, leaderboardConfig, NAME_PATTERN, rowMs, runSubmission, sanitizeName, submitRun, type Fetch } from './client'

const RUN_GO = readFileSync(new URL('../../server/pkg/run/run.go', import.meta.url), 'utf8')
const GOLDEN = JSON.parse(readFileSync(new URL('../../server/pkg/run/testdata/golden-run.json', import.meta.url), 'utf8'))
const CFG = { url: 'https://lb.test/api/1.0', token: 'secret' }

const keyboard = (t: number): CarInput => ({ throttle: 1, brake: 0, steer: t % 50 < 10 ? 1 : 0, handbrake: false })
const lap = (ticks: number): GhostRun => ({ start: createCar(), inputs: Array.from({ length: ticks }, (_, t) => keyboard(t)), lapTimeMs: ticks * 10 })

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })

describe('leaderboard name', () => {
  it('matches the server rule character for character (server/pkg/run/run.go namePattern)', () => {
    const server = RUN_GO.match(/namePattern = regexp\.MustCompile\(`(.+)`\)/)?.[1]
    expect(server).toBe(NAME_PATTERN.source)
  })

  it.each([
    ['ben', 'BEN'],
    ['  Ace Driver  ', 'ACE DRIVER'],
    ['Jörg!', 'JRG'],
    ['a_b.c-d', 'A_B.C-D'],
    ['abcdefghijklmnop', 'ABCDEFGHIJKL'],
    ['abcdefghijk   x', 'ABCDEFGHIJK'],
    ['😀😀', ''],
    ['   ', ''],
  ])('sanitises %j to %j', (raw, want) => {
    expect(sanitizeName(raw)).toBe(want)
  })

  it('every sanitised name is empty or one the server accepts', () => {
    const alphabet = 'aZ09 _.-!äé\t😀'
    for (let i = 0; i < 2000; i++) {
      let raw = ''
      for (let n = (i * 7) % 20; n > 0; n--) raw += alphabet[(i * 31 + n * 17) % alphabet.length]
      const name = sanitizeName(raw)
      if (name !== '') expect(name, JSON.stringify(raw)).toMatch(NAME_PATTERN)
    }
  })
})

describe('leaderboard config', () => {
  it('is null — online UI hidden, no network — while the URL or the token is unset', () => {
    expect(leaderboardConfig({})).toBeNull()
    expect(leaderboardConfig({ VITE_LEADERBOARD_URL: '', VITE_LEADERBOARD_TOKEN: 'x' })).toBeNull()
    expect(leaderboardConfig({ VITE_LEADERBOARD_URL: 'https://lb.test/api/1.0' })).toBeNull()
  })

  it('reads both and drops a trailing slash', () => {
    expect(leaderboardConfig({ VITE_LEADERBOARD_URL: 'https://lb.test/api/1.0/', VITE_LEADERBOARD_TOKEN: 'secret' })).toEqual(CFG)
  })
})

describe('leaderboard submission', () => {
  it('has the shape of the server golden run (server/pkg/run/testdata/golden-run.json)', () => {
    const run = runSubmission('BEN', 'test1', lap(2129), [996, 1748])
    expect(Object.keys(run)).toEqual(Object.keys(GOLDEN))
    for (const key of Object.keys(GOLDEN)) expect(typeof run[key as keyof typeof run], key).toBe(typeof GOLDEN[key])
    expect(run.totalTicks).toBe(2129)
    expect(run.ghost.s).toHaveLength(GOLDEN.ghost.s.length)
    expect(run.ghost.ms).toBe((run.totalTicks * 1000) / 100)
    expect(['s', 'keys', 'scale', 'r', 'ms']).toEqual(expect.arrayContaining(Object.keys(run.ghost)))
  })

  it('posts the run with the token and maps the answer', async () => {
    const calls: [string, RequestInit | undefined][] = []
    const fetchFn: Fetch = async (url, init) => (calls.push([url, init]), reply(201, { id: 1, best: true }))
    const run = runSubmission('BEN', 'test1', lap(300), [100])
    expect(await submitRun(CFG, run, fetchFn)).toBe('stored')
    expect(calls[0][0]).toBe('https://lb.test/api/1.0/runs')
    expect(calls[0][1]?.method).toBe('POST')
    expect((calls[0][1]?.headers as Record<string, string>)['X-Driftline-Token']).toBe('secret')
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual(JSON.parse(JSON.stringify(run)))
    expect(await submitRun(CFG, run, async () => reply(200))).toBe('kept')
    expect(await submitRun(CFG, run, async () => reply(400))).toBe('rejected')
  })

  it('retries once on a network error or 5xx, then reports offline', async () => {
    const run = runSubmission('BEN', 'test1', lap(300), [100])
    let n = 0
    expect(await submitRun(CFG, run, async () => (n++ === 0 ? Promise.reject(new TypeError('down')) : reply(201)))).toBe('stored')
    n = 0
    expect(await submitRun(CFG, run, async () => (n++, reply(503)))).toBe('offline')
    expect(n).toBe(2)
  })
})

describe('leaderboard board', () => {
  it('lists rows, says unknown on 404 and offline when unreachable', async () => {
    const rows = [{ id: 1, name: 'BEN', totalTicks: 2129, checkpointTicks: [996, 1748], createdAt: '2026-10-18T00:00:00Z' }]
    let url = ''
    expect(await fetchBoard(CFG, 'test1', async (u) => ((url = u), reply(200, rows)))).toEqual({ kind: 'rows', rows })
    expect(url).toBe('https://lb.test/api/1.0/tracks/test1/runs?limit=10')
    expect(await fetchBoard(CFG, 'test-kit', async () => reply(404))).toEqual({ kind: 'unknown' })
    expect(await fetchBoard(CFG, 'test1', async () => Promise.reject(new TypeError('down')))).toEqual({ kind: 'offline' })
    expect(rowMs(rows[0])).toBe(21_290)
  })
})
