// Time of day and weather: the optional `environment` block a track file declares as its default
// mood, and the one resolution of what a race shows (URL override, track default, or a seeded
// random pick). Render-only like `theme`: physics never reads it and it is not part of layoutId,
// so records, ghosts and golden replays never see it. Pure TypeScript and tested; the look each
// preset maps to lives in src/render/environment.ts.

export const TIMES = ['morning', 'noon', 'sunset', 'night'] as const
export type TimeOfDay = (typeof TIMES)[number]

export const WEATHERS = ['sunny', 'cloudy', 'overcast', 'rain', 'snow'] as const
export type Weather = (typeof WEATHERS)[number]

export interface Environment {
  time: TimeOfDay
  weather: Weather
}

/** A track file's default; an omitted field falls back to DEFAULT_ENVIRONMENT. */
export type EnvironmentDefault = Partial<Environment>

export const DEFAULT_ENVIRONMENT: Environment = { time: 'noon', weather: 'sunny' }

/** Start-screen setting: race in the track's own default, or a random preset per load. */
export const ENVIRONMENT_MODES = ['fixed', 'random'] as const
export type EnvironmentMode = (typeof ENVIRONMENT_MODES)[number]

/** Where the race's environment came from, shown in the debug line. */
export type EnvironmentSource = 'track' | 'random' | 'url'

export interface ResolvedEnvironment extends Environment {
  source: EnvironmentSource
  /** The random pick's seed (`?seed=` replays it); set whenever a random pick was made. */
  seed?: number
}

export const isTime = (v: unknown): v is TimeOfDay => (TIMES as readonly unknown[]).includes(v)
export const isWeather = (v: unknown): v is Weather => (WEATHERS as readonly unknown[]).includes(v)

/** Errors in an `environment` block, prefixed `environment`; empty when valid. Unknown keys are errors. */
export function validateEnvironment(data: unknown): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ['environment must be an object']
  const e = data as Record<string, unknown>
  const errs: string[] = []
  for (const k of Object.keys(e)) if (k !== 'time' && k !== 'weather') errs.push(`environment.${k}: unknown key`)
  if (e.time !== undefined && !isTime(e.time)) errs.push(`environment.time must be one of ${TIMES.join('|')}`)
  if (e.weather !== undefined && !isWeather(e.weather)) errs.push(`environment.weather must be one of ${WEATHERS.join('|')}`)
  return errs
}

/** The track's declared default over DEFAULT_ENVIRONMENT, field by field. */
export const trackEnvironment = (track: { environment?: EnvironmentDefault }): Environment => ({
  time: track.environment?.time ?? DEFAULT_ENVIRONMENT.time,
  weather: track.environment?.weather ?? DEFAULT_ENVIRONMENT.weather,
})

/** Largest seed a random pick draws; `?seed=` takes any non-negative integer. */
export const MAX_SEED = 99999

/** One of the 20 presets from a seed: same seed, same preset (mulberry32, as the scenery planner). */
export const randomEnvironment = (seed: number): Environment => {
  let s = seed | 0
  const next = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { time: TIMES[Math.floor(next() * TIMES.length)], weather: WEATHERS[Math.floor(next() * WEATHERS.length)] }
}

/**
 * The race's environment. `?time=` / `?weather=` win, each on its own (an unknown value is
 * ignored); then the mode: `fixed` is the track default, `random` a seeded pick — `?seed=` when
 * given (which also selects random), else `freshSeed` (the caller's clock; this stays pure).
 */
export function resolveEnvironment(
  search: string,
  track: { environment?: EnvironmentDefault },
  mode: EnvironmentMode,
  freshSeed: number,
): ResolvedEnvironment {
  const q = new URLSearchParams(search)
  const time = q.get('time')
  const weather = q.get('weather')
  const seedParam = q.get('seed')
  const urlSeed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : null
  const base: ResolvedEnvironment =
    mode === 'random' || urlSeed !== null
      ? (() => {
          const seed = urlSeed ?? Math.abs(Math.floor(freshSeed)) % (MAX_SEED + 1)
          return { ...randomEnvironment(seed), source: 'random', seed }
        })()
      : { ...trackEnvironment(track), source: 'track' }
  if (!isTime(time) && !isWeather(weather)) return base
  return { time: isTime(time) ? time : base.time, weather: isWeather(weather) ? weather : base.weather, source: 'url' }
}

/** Debug-line label: `night rain`, `noon cloudy random #123` (the seed replays it via `?seed=`), or `… url`. */
export const environmentLabel = (e: ResolvedEnvironment): string =>
  `${e.time} ${e.weather}${e.source === 'random' ? ` random #${e.seed}` : e.source === 'url' ? ' url' : ''}`
