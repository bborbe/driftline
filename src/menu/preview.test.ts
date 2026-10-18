import { describe, expect, it } from 'vitest'
import { medalRows, thumbUrl } from './preview'

const medals = { author: 31_500, gold: 34_000, silver: 38_500, bronze: 44_500 }

describe('medalRows', () => {
  it('lists all four medals best first with the PB delta', () => {
    expect(medalRows(medals, 35_214)).toEqual([
      { medal: 'author', ms: 31_500, deltaMs: 3_714 },
      { medal: 'gold', ms: 34_000, deltaMs: 1_214 },
      { medal: 'silver', ms: 38_500, deltaMs: -3_286 },
      { medal: 'bronze', ms: 44_500, deltaMs: -9_286 },
    ])
  })
  it('has null deltas before the first finish', () => {
    expect(medalRows(medals, null).map((r) => r.deltaMs)).toEqual([null, null, null, null])
  })
  it('is empty for a track without medals', () => {
    expect(medalRows(undefined, 12_000)).toEqual([])
  })
})

describe('thumbUrl', () => {
  it('resolves under the Vite base (root and the Pages subpath)', () => {
    expect(thumbUrl('/', 'knot')).toBe('/thumbs/knot.webp')
    expect(thumbUrl('/driftline/pr-140/', 'knot', 'drive')).toBe('/driftline/pr-140/thumbs/knot-drive.webp')
    expect(thumbUrl('/driftline', 'knot')).toBe('/driftline/thumbs/knot.webp')
  })
})
