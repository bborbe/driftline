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
  /** Full vertical loops (the kit's `loop` piece). */
  loops: number
  banked: number
  /** Share of the centreline length on each surface. */
  dirt: number
  ice: number
  /** Separate runs of each surface along the lap, as shares of its length (joined pieces are one run). */
  runs: Record<'dirt' | 'ice', number[]>
  /** Corner radii (m) on the lap: curves, banks and hairpins. */
  radii: number[]
  /** True when the lap climbs a kit level and comes back down. */
  hill: boolean
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
  const runs = (kind: 'dirt' | 'ice') => {
    const out: number[] = []
    let last = -2
    for (const z of [...(track.zones ?? [])].filter((z) => z.kind === kind).sort((a, b) => a.segment - b.segment)) {
      const d = ((z.to - z.from) * segmentLength(track.segments[z.segment])) / length
      if (z.segment === last + 1 && z.from === 0 && out.length > 0) out[out.length - 1] += d
      else out.push(d)
      last = z.to === 1 ? z.segment : -2
    }
    return out
  }
  const pieces = kit.kit.pieces.map((p) => p.piece)
  return {
    pieces,
    tight: pieces.filter((p) => p === 'curve-r1' || p === 'hairpin').length,
    loops: pieces.filter((p) => p === 'loop').length,
    banked: pieces.filter((p) => p.startsWith('bank-')).length,
    dirt: share('dirt'),
    ice: share('ice'),
    runs: { dirt: runs('dirt'), ice: runs('ice') },
    radii: track.segments.flatMap((s) => ('radius' in s && s.type !== 'loop' && s.type !== 'wallride' ? [s.radius] : [])),
    hill: pieces.includes('slope-up') && pieces.includes('slope-down'),
    length,
    track,
    kit,
  }
}

const sig = Object.fromEntries(STYLES.map((l) => [l.track, signature(l.track)]))

// Each style as a predicate over a signature: its own track passes it, every other one fails it.
// The loop is S06's set piece, so every other style is also a lap without one.
// A mixed-surface lap: the low-grip surface comes as ≥ 2 separate sections, each ≤ 25 % of the lap.
const mixed = (s: Signature, kind: 'dirt' | 'ice') => s.runs[kind].length >= 2 && s.runs[kind].every((r) => r <= 0.25)
const noLoop = (is: (s: Signature) => boolean) => (s: Signature) => s.loops === 0 && is(s)
const STYLE_OF: Record<string, (s: Signature) => boolean> = {
  // S01 Tech: ≥ 6 tight turns, asphalt and some dirt (a mix, not a dirt track).
  switchback: noLoop((s) => s.tight >= 6 && s.kit.kit.pieces.some((p) => p.surface === 'dirt') && s.dirt < 0.5),
  // S02 Fullspeed: no tight turn and no flat curve; ≥ 2 banks, all the wide flat-out bank. That full
  // throttle with no brake finishes it is full-lap.test.ts 'flatout at full throttle, no brake'.
  flatout: noLoop((s) => s.tight === 0 && !s.pieces.some((p) => p.startsWith('curve')) && s.banked >= 2 && s.pieces.filter((p) => p.startsWith('bank-')).every((p) => p === 'bank-180-wide')),
  // S03 Dirt: an asphalt lap over a hill with ≥ 2 short walled dirt sections (≥ 15 % of the lap on
  // dirt, none over 25 %), one of them a dirt chicane through the corners. Fewer than 6 tight turns:
  // the tight mix is S01's.
  dustbowl: noLoop((s) =>
    s.dirt >= 0.15 && mixed(s, 'dirt') && s.tight < 6 && s.hill &&
    s.kit.kit.pieces.some((p) => p.piece.startsWith('curve') && p.surface === 'dirt')),
  // S04 Ice: an asphalt lap over a hill with ≥ 2 short ice sections (≥ 15 % of the lap on ice, none
  // over 25 %), banked ice turns, every ice piece walled.
  glacier: noLoop((s) =>
    s.ice >= 0.15 && mixed(s, 'ice') && s.hill &&
    s.kit.kit.pieces.some((p) => p.piece.startsWith('bank-') && p.surface === 'ice') &&
    s.kit.kit.pieces.filter((p) => p.surface === 'ice').every((p) => p.walls === 'both')),
  // S05 LOL: one silly idea — a red turbo straight into five bumps.
  washboard: noLoop((s) => {
    const at = s.pieces.indexOf('turbo-red')
    return at >= 0 && s.pieces.slice(at + 1, at + 6).join() === 'bump,bump,bump,bump,bump'
  }),
  // S06 Loop: exactly one full vertical loop, the lap's one set piece, entered off a turbo.
  looping: (s) => s.loops === 1 && s.pieces[s.pieces.indexOf('loop') - 1] === 'turbo',
  // S07 Wallride: two velodrome walls, joined by a left and a right spiral that cancel out.
  velodrome: noLoop((s) => s.pieces.filter((p) => p === 'wallride').length === 2 && s.pieces.filter((p) => p === 'spiral').length === 2),
}

describe('style track signatures', () => {
  it.each(STYLES.map((l) => l.track))('%s has its own style and none of the others', (name) => {
    expect(Object.keys(STYLE_OF).sort()).toEqual(STYLES.map((l) => l.track).sort())
    for (const [style, is] of Object.entries(STYLE_OF)) expect(is(sig[name]), `${name} as ${style}`).toBe(style === name)
  })
})

describe('style tracks are distinct', () => {
  const names = STYLES.map((l) => l.track)
  const pairs = names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b] as const))

  it.each(pairs)('%s and %s differ in piece mix and clearly in at least one measure', (a, b) => {
    const [s, t] = [sig[a], sig[b]]
    expect([...s.pieces].sort()).not.toEqual([...t.pieces].sort())
    // Absolute floors, so a sprinkle of dirt or one extra piece never counts as a different track.
    const measures = [
      Math.abs(s.tight - t.tight) >= 2,
      Math.abs(s.banked - t.banked) >= 2,
      s.loops !== t.loops,
      Math.abs(s.dirt - t.dirt) >= 0.15,
      Math.abs(s.ice - t.ice) >= 0.15,
      Math.abs(s.length - t.length) / Math.max(s.length, t.length) >= 0.25,
    ]
    expect(measures.some(Boolean), `${a} vs ${b}`).toBe(true)
  })
})

// The surface tracks are mostly asphalt with surface sections as features, on a line with corner
// variety: a tight (r 10 m), a medium (r 20 m) and a wide (r ≥ 30 m) corner, and a climb and a fall.
describe('surface style tracks', () => {
  it.each(['dustbowl', 'glacier'])('%s mixes corner radii and has a hill', (name) => {
    const s = sig[name]
    expect(s.radii.some((r) => r <= 10), 'tight').toBe(true)
    expect(s.radii.some((r) => r === 20), 'medium').toBe(true)
    expect(s.radii.some((r) => r >= 30), 'wide').toBe(true)
    expect(s.hill).toBe(true)
    expect(s.dirt + s.ice, 'asphalt ≥ 60 %').toBeLessThanOrEqual(0.4)
  })
})
