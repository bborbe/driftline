// Every shipped track is mostly asphalt: dirt, ice and grass are sections of a lap, never the lap
// (operator, 2026-10-17: "driving 90% of the time over snow or dirt is boring"). Measured on the
// centreline: the share of its length outside every low-grip surface zone.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveTrack } from './kit'
import { isSurface, segmentLength, type Track } from './schema'

/** Minimum share of every lap's centreline on asphalt. */
const MIN_ASPHALT = 0.6

const dir = new URL('../../assets/track/', import.meta.url)
const names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'pieces.json').map((f) => f.slice(0, -'.json'.length))

/** Share of a track's centreline length that is not inside a dirt, ice or grass zone. */
export function asphaltShare(track: Track): number {
  const length = track.segments.reduce((d, s) => d + segmentLength(s), 0)
  const low = (track.zones ?? []).filter((z) => isSurface(z.kind)).reduce((d, z) => d + (z.to - z.from) * segmentLength(track.segments[z.segment]), 0)
  return 1 - low / length
}

describe('asphalt share', () => {
  it.each(names)(`%s has ≥ ${MIN_ASPHALT * 100} % of its lap on asphalt`, (name) => {
    const track = resolveTrack(JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'))) as Track
    expect(asphaltShare(track)).toBeGreaterThanOrEqual(MIN_ASPHALT)
  })
})
