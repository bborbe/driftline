// Online leaderboard client for the server in server/ (`/api/1.0/`): the display-name rule, the build-time config, the
// submitted run and the two calls the game makes — submit a finished lap, list a track's top runs. No credential ships
// in the game: the server trusts its Origin allow-list (the browser adds the Origin) and validates every run. Network
// calls take `fetch` as a parameter so tests never touch the network. Pure and tested.
import { ghostPayload, MAX_NAME } from '../challenge/link'
import type { GhostRun } from '../ghost/ghost'
import { TICK_HZ } from '../physics'

/** The server's name rule (namePattern in server/pkg/run/run.go): 1–12 of A-Z 0-9 space _ . -, no outer spaces. */
export const NAME_PATTERN = /^[A-Z0-9_.-](?:[A-Z0-9 _.-]{0,10}[A-Z0-9_.-])?$/
/** Board rows the game shows (the server's default limit). */
export const BOARD_TOP = 10

/** A typed name as the server accepts it: upper case, other characters dropped, cut to 12; '' when nothing is left. */
export const sanitizeName = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9 _.-]/g, '').trim().slice(0, MAX_NAME).trim()

export interface LeaderboardConfig {
  /** API base without a trailing slash, e.g. `https://driftline.example/api/1.0`. */
  url: string
}

/** Build-time config (VITE_LEADERBOARD_URL); null when it is unset — the game stays offline. */
export function leaderboardConfig(env: Record<string, unknown>): LeaderboardConfig | null {
  const url = typeof env.VITE_LEADERBOARD_URL === 'string' ? env.VITE_LEADERBOARD_URL.trim().replace(/\/+$/, '') : ''
  return url ? { url } : null
}

/** One finished lap as the server's POST /runs decodes it (run.Submission). */
export interface RunSubmission {
  name: string
  track: string
  totalTicks: number
  /** Tick of each checkpoint pass after the lap's first tick, in order. */
  checkpointTicks: number[]
  ghost: ReturnType<typeof ghostPayload>
}

export const runSubmission = (name: string, track: string, ghost: GhostRun, checkpointTicks: readonly number[]): RunSubmission => ({
  name,
  track,
  totalTicks: ghost.inputs.length,
  checkpointTicks: [...checkpointTicks],
  ghost: ghostPayload(ghost),
})

/** One board row as GET /tracks/{track}/runs lists it (storage.Run). */
export interface BoardRow {
  id: number
  name: string
  totalTicks: number
  checkpointTicks: number[]
  createdAt: string
}

/** A board row's lap time in ms (the game's fixed tick rate). */
export const rowMs = (row: BoardRow): number => (row.totalTicks * 1000) / TICK_HZ

/** `stored`: the run is now the player's best; `kept`: an equal or faster one already is; `rejected`: the server refused it. */
export type SubmitResult = 'stored' | 'kept' | 'rejected' | 'offline'
/** `unknown`: the server ranks no runs on this track (no finish or no author medal). */
export type BoardRead = { kind: 'rows'; rows: BoardRow[] } | { kind: 'unknown' } | { kind: 'offline' }

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** A request, tried once more on a network error or a 5xx; null when both tries failed. */
async function request(fetchFn: Fetch, url: string, init: RequestInit): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetchFn(url, init)
      if (resp.status < 500) return resp
    } catch {
      // network error: try once more, then offline
    }
  }
  return null
}

export async function submitRun(cfg: LeaderboardConfig, run: RunSubmission, fetchFn: Fetch = fetch): Promise<SubmitResult> {
  const resp = await request(fetchFn, `${cfg.url}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run),
  })
  if (!resp) return 'offline'
  if (resp.status === 201) return 'stored'
  if (resp.status === 200) return 'kept'
  return 'rejected'
}

export async function fetchBoard(cfg: LeaderboardConfig, track: string, fetchFn: Fetch = fetch): Promise<BoardRead> {
  const resp = await request(fetchFn, `${cfg.url}/tracks/${encodeURIComponent(track)}/runs?limit=${BOARD_TOP}`, {})
  if (!resp) return { kind: 'offline' }
  if (resp.status === 404) return { kind: 'unknown' }
  if (!resp.ok) return { kind: 'offline' }
  try {
    const rows: unknown = await resp.json()
    return Array.isArray(rows) ? { kind: 'rows', rows: rows as BoardRow[] } : { kind: 'offline' }
  } catch {
    return { kind: 'offline' }
  }
}
