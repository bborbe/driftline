// The showcase track (assets/track/showcase.json) chains every set-piece of the kit into one lap.
// These checks pin what makes it the showcase: the pieces it must carry, the loop's own gate, the
// deck that crosses the lap, and medals on the campaign ratios.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileKit, type KitTrack } from './kit'
import { partialPose, segmentLength } from './pose'
import { validate } from './schema'
import { MEDAL_ORDER } from '../race/medals'

const kt = JSON.parse(readFileSync(new URL('../../assets/track/showcase.json', import.meta.url), 'utf8')) as KitTrack
const pieces = kt.kit.pieces.map((p) => p.piece)

describe('showcase track', () => {
  it('compiles to a valid lap', () => {
    expect(validate(compileKit(kt).track)).toEqual([])
  })

  it.each(['loop', 'wallride', 'spiral', 'gap-jump', 'corner-tight', 'corner-medium', 'corner-wide'])('places a %s', (piece) => {
    expect(pieces).toContain(piece)
  })

  it('places a turbo pad', () => {
    expect(pieces.some((p) => p === 'turbo' || p === 'turbo-red')).toBe(true)
  })

  it('adds no checkpoint next to a loop: the loop carries its own at the top', () => {
    pieces.forEach((p, i) => {
      if (p !== 'loop') return
      expect(pieces[i - 1]).not.toBe('checkpoint')
      expect(pieces[i + 1]).not.toBe('checkpoint')
    })
  })

  it('crosses itself: a deck at least 7 m above another stretch of the lap', () => {
    const { track } = compileKit(kt)
    const entries = [track.start]
    for (const seg of track.segments) entries.push(partialPose(entries[entries.length - 1], seg, 1))
    // Loops and wallrides fold over themselves by design; only the road between them counts.
    const pts = track.segments.flatMap((seg, s) => {
      if (seg.type === 'loop' || seg.type === 'wallride') return []
      const n = Math.max(2, Math.ceil(segmentLength(seg) / 2))
      return Array.from({ length: n + 1 }, (_, k) => ({ s, ...partialPose(entries[s], seg, k / n) }))
    })
    const crossing = pts.some((a) => pts.some((b) => Math.abs(a.s - b.s) > 2 && Math.hypot(a.x - b.x, a.z - b.z) < 2 && a.y - b.y >= 7))
    expect(crossing).toBe(true)
  })

  it('ships medals on the campaign ratios: gold +8 %, silver +22 %, bronze +42 % of author, each within 1 %', () => {
    const m = kt.medals!
    const times = MEDAL_ORDER.map((k) => m[k])
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true)
    for (const [k, r] of [['gold', 1.08], ['silver', 1.22], ['bronze', 1.42]] as const) {
      expect(Math.abs(m[k] / m.author / r - 1), k).toBeLessThan(0.01)
    }
  })
})
