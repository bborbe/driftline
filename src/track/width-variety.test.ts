// Width as a design tool on every main track (campaign, styles, showcase): a narrow technical
// section and a wide fast one, long enough for a driver to notice, joined by tapers, never a step.
// Loops and wallrides keep their own widths (no `width` set), so this pass never touches them.
import { describe, expect, it } from 'vitest'
import { loadTrack } from '../race/autopilot.test-driver'
import { CAMPAIGN, STYLES } from './catalogue'
import { segmentLength, widthAt, type Segment } from './schema'

const MAIN_TRACKS = [...CAMPAIGN, ...STYLES].map((l) => l.track).concat('showcase')

/** Narrow: at most this wide (m). Wide: at least WIDE. */
const NARROW = 11
const WIDE = 16
/** Centreline metres each must cover to read as a section, not a blip. */
const MIN_RUN = 30
/** Largest width jump allowed where two segments meet (m): a taper, never a step. */
const MAX_STEP = 0.5

const own = (seg: Segment) => seg.type === 'loop' || seg.type === 'wallride'

describe.each(MAIN_TRACKS)('%s road width', (name) => {
  const segs = loadTrack(name).segments

  it('has a narrow and a wide section, each at least MIN_RUN metres long', () => {
    let narrow = 0
    let wide = 0
    for (const seg of segs.filter((s) => !own(s))) {
      const len = segmentLength(seg)
      for (let d = 0.5; d < len; d++) {
        const w = widthAt(seg, d / len)
        if (w <= NARROW) narrow++
        if (w >= WIDE) wide++
      }
    }
    expect(narrow, `${name}: metres at ≤ ${NARROW} m`).toBeGreaterThanOrEqual(MIN_RUN)
    expect(wide, `${name}: metres at ≥ ${WIDE} m`).toBeGreaterThanOrEqual(MIN_RUN)
  })

  it('tapers between widths: no step where two segments meet', () => {
    segs.forEach((seg, i) => {
      const next = segs[(i + 1) % segs.length]
      if (own(seg) || own(next)) return
      expect(Math.abs(widthAt(seg, 1) - widthAt(next, 0)), `${name} seg ${i} → ${(i + 1) % segs.length}`).toBeLessThanOrEqual(MAX_STEP)
    })
  })

  it('leaves loops and wallrides at their own width', () => {
    for (const seg of segs.filter(own)) expect(seg.width).toBeUndefined()
  })
})
