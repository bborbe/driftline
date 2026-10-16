// The shipped lap, validated against the schema. Falls back to the fixture so a
// broken lap file shows a warning and a drivable scene instead of a blank page.
import { validate, type Track } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'

const LAPS = import.meta.glob('/assets/track/lap1.json', { import: 'default', eager: true }) as Record<string, unknown>

export const loadLap = (): Track => {
  const data = LAPS['/assets/track/lap1.json']
  const errs = validate(data)
  if (errs.length > 0) {
    console.warn(`lap1.json invalid, using fixture track: ${errs.join('; ')}`)
    return FIXTURE_TRACK
  }
  return data as Track
}
