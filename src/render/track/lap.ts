// The shipped tracks, validated against the schema. `?track=<name>` picks one (default test1);
// old names (lap1, lap2) resolve through the catalogue's aliases.
// Falls back to the fixture so a broken track file shows a warning and a drivable scene instead of a blank page.
import { menuOrder, nextInGroup, resolveAlias } from '../../track/catalogue'
import { validate, type Track } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'

// Every track JSON except the piece catalogue (pieces.json) is a drivable lap.
const LAPS = import.meta.glob(['/assets/track/*.json', '!/assets/track/pieces.json'], { import: 'default', eager: true }) as Record<
  string,
  unknown
>

export const DEFAULT_LAP = 'test1'

/** Shipped track names in menu order: campaign levels, then test tracks (src/track/catalogue.ts). */
export const LAP_NAMES = menuOrder(Object.keys(LAPS).map((k) => k.slice('/assets/track/'.length, -'.json'.length)))

/** The track after `name` within its menu group (campaign or test), wrapping to the group's first. */
export const nextLap = (name: string, names: string[] = LAP_NAMES): string => nextInGroup(name, names)

/** Track name from a URL query string; aliases resolve, unknown or missing names fall back to DEFAULT_LAP. */
export const lapName = (search: string): string => {
  const name = resolveAlias(new URLSearchParams(search).get('track') ?? DEFAULT_LAP)
  return `/assets/track/${name}.json` in LAPS ? name : DEFAULT_LAP
}

export const loadLap = (name: string = lapName(location.search)): Track => {
  const data = LAPS[`/assets/track/${resolveAlias(name)}.json`]
  const errs = validate(data)
  if (errs.length > 0) {
    console.warn(`${name}.json invalid, using fixture track: ${errs.join('; ')}`)
    return FIXTURE_TRACK
  }
  return data as Track
}
