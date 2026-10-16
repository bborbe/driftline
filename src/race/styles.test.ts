// Style tracks S01-S05: each is built only from the kit, for one Trackmania map style, and the
// style is a measurable signature of the compiled lap, not a claim. Lap-time windows and the ship
// gates live with the other tracks (full-lap.test.ts, cuts.test.ts).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileKit, isKitTrack, type KitTrack } from '../track/kit'
import { STYLES } from '../track/catalogue'
import { segmentLength, type Track } from '../track/schema'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as unknown

interface Signature {
  pieces: string[]
  /** Tight turns: r 10 m kinks and hairpins. */
  tight: number
  banked: number
  /** Share of the centreline length on each surface. */
  dirt: number
  ice: number
  length: number
  track: Track
  kit: KitTrack
}

function signature(name: string): Signature {
  const raw = read(name)
  expect(isKitTrack(raw), `${name} is a kit track`).toBe(true)
  const kit = raw as KitTrack
  const { track } = compileKit(kit)
  const length = track.segments.reduce((d, s) => d + segmentLength(s), 0)
  const share = (kind: string) =>
    (track.zones ?? []).filter((z) => z.kind === kind).reduce((d, z) => d + (z.to - z.from) * segmentLength(track.segments[z.segment]), 0) / length
  const pieces = kit.kit.pieces.map((p) => p.piece)
  return {
    pieces,
    tight: pieces.filter((p) => p === 'curve-r1' || p === 'hairpin').length,
    banked: pieces.filter((p) => p.startsWith('bank-')).length,
    dirt: share('dirt'),
    ice: share('ice'),
    length,
    track,
    kit,
  }
}

const sig = Object.fromEntries(STYLES.map((l) => [l.track, signature(l.track)]))

describe('style track signatures', () => {
  it('S01 switchback (Tech): ≥ 6 tight turns, asphalt and dirt', () => {
    const s = sig.switchback
    expect(s.tight).toBeGreaterThanOrEqual(6)
    expect(s.kit.kit.pieces.some((p) => p.surface === 'dirt')).toBe(true)
    expect(s.dirt).toBeLessThan(0.5) // a mix, not a dirt track
  })

  it('S02 flatout (Fullspeed): no tight turn, ≥ 2 banks, all of them the wide flat-out bank', () => {
    const s = sig.flatout
    expect(s.tight).toBe(0)
    expect(s.pieces.filter((p) => p === 'curve-r1' || p === 'curve-r2' || p === 'curve-r3')).toEqual([])
    expect(s.banked).toBeGreaterThanOrEqual(2)
    expect(s.pieces.filter((p) => p.startsWith('bank-')).every((p) => p === 'bank-180-wide')).toBe(true)
    // Full throttle with no brake finishes it: full-lap.test.ts 'flatout at full throttle, no brake'.
  })

  it('S03 dustbowl (Dirt): ≥ 50 % of the lap on dirt, dirt through the corners', () => {
    const s = sig.dustbowl
    expect(s.dirt).toBeGreaterThanOrEqual(0.5)
    expect(s.kit.kit.pieces.some((p) => p.piece.startsWith('curve') && p.surface === 'dirt')).toBe(true)
  })

  it('S04 glacier (Ice): ≥ 50 % of the lap on ice, a banked ice channel', () => {
    const s = sig.glacier
    expect(s.ice).toBeGreaterThanOrEqual(0.5)
    expect(s.kit.kit.pieces.some((p) => p.piece.startsWith('bank-') && p.surface === 'ice')).toBe(true)
    expect(s.kit.kit.pieces.filter((p) => p.surface === 'ice').every((p) => p.walls === 'both')).toBe(true)
  })

  it('S05 washboard (LOL): one silly idea — a red turbo straight into five bumps', () => {
    const p = sig.washboard.pieces
    const at = p.indexOf('turbo-red')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(p.slice(at + 1, at + 6)).toEqual(['bump', 'bump', 'bump', 'bump', 'bump'])
  })
})

describe('style tracks are distinct', () => {
  const names = STYLES.map((l) => l.track)
  const pairs = names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b] as const))
  // At least 25 % apart in one measure (relative to the larger value; two zeros are not apart).
  const apart = (x: number, y: number) => Math.max(x, y) > 0 && Math.abs(x - y) / Math.max(x, y) >= 0.25

  it.each(pairs)('%s and %s differ in piece mix and in at least one measure by ≥ 25 %%', (a, b) => {
    const [s, t] = [sig[a], sig[b]]
    expect([...s.pieces].sort()).not.toEqual([...t.pieces].sort())
    const measures = [
      apart(s.tight, t.tight),
      apart(s.banked, t.banked),
      apart(s.dirt, t.dirt),
      apart(s.ice, t.ice),
      apart(s.length, t.length),
    ]
    expect(measures.some(Boolean), `${a} vs ${b}`).toBe(true)
  })
})
