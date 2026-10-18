// URL state: the query mirrors the screen, every Settings choice (`rec` = Records panel), the camera view and the fly pose, so a reload
// (or a shared link) restores the same setup. URL beats localStorage beats the defaults; a race reload starts on
// the grid (no car pose is written). Pure and tested, except startUrlSync, which owns history.replaceState.
import { FX } from '../render/fx/flags'
import { clampLaps } from '../race/lap'
import { MAX_NUMBER, PAINT_IDS, PATTERNS } from '../render/car/livery'
import { TIME_CHOICES, WEATHER_CHOICES } from '../track/environment'
import { VIEWS, type ViewMode } from '../camera/views'
import { flyQuery, type FlyCam } from '../camera/fly'
import { clampHudScale, type Settings } from './settings'
import { PRESETS, QUALITY, qualityKnobs, sameKnobs, type Knobs, type Quality } from '../render/quality'
import { RECORDS_CHOICES } from '../race/records'

/** Where the player is: in a race on `track`, or on the start menu with card `sel` focused (null: none). */
export type Screen = { track: string } | { sel: string | null }

export interface UrlState {
  settings: Settings
  view: ViewMode
  screen: Screen
  /** The free-fly camera while flying, null when not, undefined before the camera exists (fly params kept as they are). */
  fly: FlyCam | null | undefined
  /** Track orbit on (O) while flying. */
  orbiting?: boolean
  /** The page's boot query: leaving fly mode puts back the car spawn or `cam=top` it carried, if not a fly link. */
  boot?: string
}

const FLY_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'cam'] as const
/** Every key a debug spawn or camera link sets. */
const POSE_KEYS = [...FLY_KEYS, 'freeze', 'orbit'] as const

/** `v` when it is one of `ok`, else `fallback`. */
const oneOf = <T>(v: string | null, ok: readonly T[], fallback: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : fallback)

/** Stored settings with every setting the query names laid over them; a missing or unknown value keeps the stored one. */
export function settingsFromUrl(search: string, stored: Settings): Settings {
  const q = new URLSearchParams(search)
  const vol = q.get('vol') ? Number(q.get('vol')) : NaN
  const laps = q.get('laps') ? Number(q.get('laps')) : NaN
  const num = q.get('num') ? Math.round(Number(q.get('num'))) : NaN
  const { quality, knobs } = qualityFromUrl(q, stored)
  return {
    volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : stored.volume,
    // The SFX and UI buses stay out of the URL: they are a player's own mix, not part of a shared setup.
    sfxVolume: stored.sfxVolume,
    uiVolume: stored.uiVolume,
    fx: q.has('fx') ? FX.filter((f) => (q.get('fx') ?? '').split(',').includes(f)) : [...stored.fx],
    laps: clampLaps(laps, stored.laps),
    time: oneOf(q.get('time'), TIME_CHOICES, stored.time),
    weather: oneOf(q.get('weather'), WEATHER_CHOICES, stored.weather),
    livery: {
      pattern: oneOf(q.get('pattern'), PATTERNS, stored.livery.pattern),
      paint: oneOf(q.get('paint'), PAINT_IDS, stored.livery.paint),
      number: Number.isFinite(num) && num >= 1 ? Math.min(MAX_NUMBER, num) : stored.livery.number,
    },
    hudScale: q.has('hud') ? clampHudScale(Number(q.get('hud'))) : stored.hudScale,
    records: oneOf(q.get('rec'), RECORDS_CHOICES, stored.records),
    quality,
    knobs,
    // Colour-safe and reduced effects stay out of the URL: they are the player's own needs, not part of a shared setup.
    colourSafe: stored.colourSafe,
    reducedEffects: stored.reducedEffects,
  }
}

/** `?quality=` names the quality (a preset brings its knobs); `?refl=` / `?aa=` then override one knob, and a knob that differs makes it Custom. */
function qualityFromUrl(q: URLSearchParams, stored: Settings): { quality: Quality; knobs: Knobs } {
  let quality = oneOf(q.get('quality'), QUALITY, stored.quality)
  let knobs: Knobs = (PRESETS as readonly string[]).includes(quality) ? qualityKnobs(quality as (typeof PRESETS)[number]) : { ...stored.knobs }
  const base = { ...knobs }
  const flag = (key: string, v: boolean) => (q.get(key) === '1' ? true : q.get(key) === '0' ? false : v)
  knobs = { ...knobs, reflections: flag('refl', knobs.reflections), aa: flag('aa', knobs.aa) }
  if (!sameKnobs(base, knobs)) quality = 'custom'
  return { quality, knobs }
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
  // A `?seed=` link names the environment itself; a written time/weather would override it on the next load.
  if (!q.has('seed')) {
    q.set('time', s.time)
    q.set('weather', s.weather)
  }
  q.set('laps', String(s.laps))
  q.set('fx', s.fx.join(','))
  q.set('vol', String(s.volume))
  q.set('view', state.view)
  q.set('pattern', s.livery.pattern)
  q.set('paint', s.livery.paint)
  q.set('num', String(s.livery.number))
  q.set('hud', String(s.hudScale))
  q.set('rec', s.records)
  q.set('quality', s.quality)
  // A preset or Auto names every knob itself; only Custom writes the two knobs a link can carry.
  if (s.quality === 'custom') {
    q.set('refl', s.knobs.reflections ? '1' : '0')
    q.set('aa', s.knobs.aa ? '1' : '0')
  } else {
    q.delete('refl')
    q.delete('aa')
  }
  if (state.fly && 'track' in state.screen) {
    const pose = new URLSearchParams(flyQuery(state.screen.track, state.fly))
    for (const k of FLY_KEYS) q.set(k, pose.get(k)!)
    if (state.orbiting) q.set('orbit', '1')
    else q.delete('orbit')
  } else if (state.fly === null && q.get('cam') === 'fly') {
    // Leaving fly mode drops the fly link, freeze and orbit included, so a reload races from the grid; a car spawn
    // or `cam=top` the page booted with comes back.
    const boot = new URLSearchParams(state.boot ?? '')
    const keep = boot.get('cam') === 'fly' ? new URLSearchParams() : boot
    for (const k of POSE_KEYS) {
      const v = keep.get(k)
      if (v === null) q.delete(k)
      else q.set(k, v)
    }
  }
  const out = q.toString()
  return out ? `?${out}` : ''
}

/** The query that opens `screen` with this state: no spawn, fly, camera or challenge link (Back to menu, Next track). */
export const screenQuery = (search: string, state: UrlState, screen: Screen): string => {
  const q = new URLSearchParams(search)
  for (const k of POSE_KEYS) q.delete(k)
  q.delete('challenge')
  return stateQuery(q.toString(), { ...state, screen, fly: null, boot: '' })
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
