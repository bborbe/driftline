// URL state: the query mirrors the screen, every Settings choice, the camera view and the fly pose, so a reload
// (or a shared link) restores the same setup. URL beats localStorage beats the defaults; a race reload starts on
// the grid (no car pose is written). Pure and tested, except startUrlSync, which owns history.replaceState.
import { FX } from '../render/fx/flags'
import { clampLaps } from '../race/lap'
import { MAX_NUMBER, PAINT_IDS, PATTERNS } from '../render/car/livery'
import { TIME_CHOICES, WEATHER_CHOICES } from '../track/environment'
import { VIEWS, type ViewMode } from '../camera/views'
import { flyQuery, type FlyCam } from '../camera/fly'
import type { Settings } from './settings'

/** Where the player is: in a race on `track`, or on the start menu with card `sel` focused (null: none). */
export type Screen = { track: string } | { sel: string | null }

export interface UrlState {
  settings: Settings
  view: ViewMode
  screen: Screen
  /** The free-fly camera while flying, null when not, undefined before the camera exists (fly params kept as they are). */
  fly: FlyCam | null | undefined
}

const FLY_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'cam'] as const

/** `v` when it is one of `ok`, else `fallback`. */
const oneOf = <T>(v: string | null, ok: readonly T[], fallback: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : fallback)

/** Stored settings with every setting the query names laid over them; a missing or unknown value keeps the stored one. */
export function settingsFromUrl(search: string, stored: Settings): Settings {
  const q = new URLSearchParams(search)
  const vol = q.get('vol') ? Number(q.get('vol')) : NaN
  const laps = q.get('laps') ? Number(q.get('laps')) : NaN
  const num = q.get('num') ? Math.round(Number(q.get('num'))) : NaN
  return {
    volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : stored.volume,
    fx: q.has('fx') ? FX.filter((f) => (q.get('fx') ?? '').split(',').includes(f)) : [...stored.fx],
    laps: clampLaps(laps, stored.laps),
    time: oneOf(q.get('time'), TIME_CHOICES, stored.time),
    weather: oneOf(q.get('weather'), WEATHER_CHOICES, stored.weather),
    livery: {
      pattern: oneOf(q.get('pattern'), PATTERNS, stored.livery.pattern),
      paint: oneOf(q.get('paint'), PAINT_IDS, stored.livery.paint),
      number: Number.isFinite(num) && num >= 1 ? Math.min(MAX_NUMBER, num) : stored.livery.number,
    },
  }
}

/** `?view=` when it names a view, else the stored one. */
export const viewFromUrl = (search: string, stored: ViewMode): ViewMode => oneOf(new URLSearchParams(search).get('view'), VIEWS, stored)

/** The query for `state`, keeping every other parameter (debug, dev, renderer, seed, a debug spawn) as it was. */
export function stateQuery(search: string, state: UrlState): string {
  const q = new URLSearchParams(search)
  if ('track' in state.screen) {
    q.set('track', state.screen.track)
    q.delete('sel')
  } else {
    q.delete('track')
    if (state.screen.sel === null) q.delete('sel')
    else q.set('sel', state.screen.sel)
  }
  const s = state.settings
  q.set('time', s.time)
  q.set('weather', s.weather)
  q.set('laps', String(s.laps))
  q.set('fx', s.fx.join(','))
  q.set('vol', String(s.volume))
  q.set('view', state.view)
  q.set('pattern', s.livery.pattern)
  q.set('paint', s.livery.paint)
  q.set('num', String(s.livery.number))
  if (state.fly && 'track' in state.screen) {
    const pose = new URLSearchParams(flyQuery(state.screen.track, state.fly))
    for (const k of FLY_KEYS) q.set(k, pose.get(k)!)
  } else if (state.fly === null && q.get('cam') === 'fly') {
    // Leaving fly mode drops the fly link with it, freeze and orbit included, so a reload races from the grid.
    for (const k of [...FLY_KEYS, 'freeze', 'orbit']) q.delete(k)
  }
  const out = q.toString()
  return out ? `?${out}` : ''
}

/** Keep the address bar on `state()` at 4 Hz and on pagehide, through history.replaceState (no new history entries). */
export function startUrlSync(state: () => UrlState, everyMs = 250): void {
  const flush = () => {
    const q = stateQuery(location.search, state())
    if (q !== location.search) history.replaceState(history.state, '', `${location.pathname}${q}${location.hash}`)
  }
  setInterval(flush, everyMs)
  window.addEventListener('pagehide', flush)
  flush()
}
