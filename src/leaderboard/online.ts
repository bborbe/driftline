// The race's online leaderboard: fetches the track's global top 10 once at load and after each submit, and submits each
// finished single-lap run (the kept ghost plus its checkpoint ticks) under the player's name. A run finished before a
// name is set waits for one (the results card asks). Nothing here blocks the race or the results card: every call is
// fire-and-forget, a failed request is retried once (client.ts), and an offline browser skips silently with an
// "offline" note. A track the server does not rank (404) and a multi-lap run have no global board. Created only when
// leaderboardConfig() is non-null, so a build without the env makes no network call. Tested with a fake fetch.
import type { GhostRun } from '../ghost/ghost'
import type { RaceEvents } from '../race/lap'
import { loadPlayerName, savePlayerName } from '../race/store'
import { fetchBoard, runSubmission, sanitizeName, submitRun, type BoardRow, type Fetch, type LeaderboardConfig, type RunSubmission } from './client'

/** `loading` before the first answer; `offline` when the server could not be reached. */
export type GlobalBoard = { state: 'loading' } | { state: 'rows'; rows: BoardRow[] } | { state: 'offline' }

export interface OnlineBoard {
  /** The board to show, or null: no Global tab (the server does not rank this track, or a multi-lap run). */
  board(): GlobalBoard | null
  /** Short status under the board: '' | 'offline' | 'submitting…' | 'not accepted'. */
  note(): string
  /** The player's name as submitted (sanitised), '' when none is set. */
  name(): string
  /** True while a finished run waits for a name. */
  needsName(): boolean
  /** The player typed a name: store it sanitised and submit a waiting run. */
  setName(raw: string): void
  /** Race listener: the checkpoint ticks of the lap being driven. */
  listener(): RaceEvents
  /** The ghost recorder kept a finished lap (GhostRecorder.onKeep). */
  lapKept(run: GhostRun): void
  /** Hears a submit or board answer change what the board shows (the race view redraws). */
  onChange: (() => void) | null
}

export interface OnlineOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  laps: () => number
  fetch?: Fetch
  /** navigator.onLine; false skips a submit without a request. */
  online?: () => boolean
}

export function createOnline(cfg: LeaderboardConfig, track: string, opts: OnlineOptions): OnlineBoard {
  const fetchFn = opts.fetch ?? ((input, init) => fetch(input, init))
  const isOnline = opts.online ?? (() => true)
  let board: GlobalBoard | null = { state: 'loading' }
  let note = ''
  let lapStart = 0
  let checkpoints: number[] = []
  let waiting: { run: GhostRun; checkpoints: number[] } | null = null
  const changed = () => api.onChange?.()
  // Settles once the first board answer is in: a lap kept before it waits, so a track the server turns out not to
  // rank (404) never gets a submit.
  let firstBoard: Promise<void> = Promise.resolve()
  const name = () => sanitizeName(loadPlayerName(opts.storage))

  const refresh = async () => {
    const read = await fetchBoard(cfg, track, fetchFn)
    if (read.kind === 'unknown') board = null
    else if (read.kind === 'rows') board = { state: 'rows', rows: read.rows }
    // Keep the last rows when a refresh fails; only a board that never loaded reads offline.
    else if (board?.state !== 'rows') board = { state: 'offline' }
    changed()
  }

  const submit = async (payload: RunSubmission) => {
    if (!isOnline()) {
      note = 'offline'
      return changed()
    }
    note = 'submitting…'
    changed()
    const result = await submitRun(cfg, payload, fetchFn)
    note = result === 'offline' ? 'offline' : result === 'rejected' ? 'not accepted' : ''
    if (result === 'offline') return changed()
    await refresh()
  }

  const send = (run: GhostRun, cps: number[]) => {
    const n = name()
    if (!n) {
      waiting = { run, checkpoints: cps }
      return changed()
    }
    void submit(runSubmission(n, track, run, cps))
  }

  const api: OnlineBoard = {
    onChange: null,
    board: () => (opts.laps() === 1 ? board : null),
    note: () => note,
    name,
    needsName: () => waiting !== null,
    setName(raw) {
      const n = sanitizeName(raw)
      if (!n) return
      savePlayerName(opts.storage, n)
      const w = waiting
      waiting = null
      if (w) send(w.run, w.checkpoints)
    },
    listener: () => ({
      lapStart: (tick) => {
        lapStart = tick
        checkpoints = []
      },
      checkpoint: (tick) => checkpoints.push(tick - lapStart),
    }),
    lapKept(run) {
      if (opts.laps() !== 1) return
      const cps = checkpoints.slice()
      void firstBoard.then(() => {
        if (board !== null) send(run, cps)
      })
    },
  }
  firstBoard = refresh()
  return api
}
