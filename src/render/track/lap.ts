// The shipped laps, validated against the schema. `?track=<name>` picks one (default lap1).
// Falls back to the fixture so a broken lap file shows a warning and a drivable scene instead of a blank page.
import { validate, type Track } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'

const LAPS = import.meta.glob('/assets/track/lap*.json', { import: 'default', eager: true }) as Record<string, unknown>

export const DEFAULT_LAP = 'lap1'

/** Shipped lap names in order (lap1, lap2, …). */
export const LAP_NAMES = Object.keys(LAPS)
  .map((k) => k.slice('/assets/track/'.length, -'.json'.length))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

/** The lap after `name`, wrapping to the first. */
export const nextLap = (name: string, names: string[] = LAP_NAMES): string => names[(names.indexOf(name) + 1) % names.length]

/** Track name from a URL query string; unknown or missing names fall back to DEFAULT_LAP. */
export const lapName = (search: string): string => {
  const name = new URLSearchParams(search).get('track') ?? DEFAULT_LAP
  return `/assets/track/${name}.json` in LAPS ? name : DEFAULT_LAP
}

export const loadLap = (name: string = lapName(location.search)): Track => {
  const data = LAPS[`/assets/track/${name}.json`]
  const errs = validate(data)
  if (errs.length > 0) {
    console.warn(`${name}.json invalid, using fixture track: ${errs.join('; ')}`)
    return FIXTURE_TRACK
  }
  return data as Track
}
