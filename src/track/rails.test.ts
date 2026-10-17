// Edge rails line every road edge of every shipped track — bridges and embankments included — and
// step aside only where the rail would stand on another part of the lap (a loop's run-in beside its run-out).
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planBodies, rowCount } from './bodies'
import { RAIL, railBoxes, railRuns, railSides } from './rails'
import { resolveTrack } from './kit'
import type { Track } from './schema'

const DIR = new URL('../../assets/track/', import.meta.url)
const load = (name: string) => resolveTrack(JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8'))) as Track
const TRACKS = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  .filter((name) => Array.isArray(load(name).segments))

/** Fraction of a segment's length one edge's rails cover: the row spans inside its runs. */
const coverage = (track: Track, segment: number, side: 1 | -1): number => {
  const rows = rowCount(track.segments[segment])
  const spans = railRuns(track)
    .filter((r) => r.segment === segment && r.side === side)
    .reduce((sum, r) => sum + r.rows.length - 1, 0)
  return spans / (rows - 1)
}

const nextToLoop = (track: Track, i: number): boolean => {
  const n = track.segments.length
  return track.segments[(i + n - 1) % n].type === 'loop' || track.segments[(i + 1) % n].type === 'loop'
}

describe.each(TRACKS)('%s rails', (name) => {
  const track = load(name)

  it('cover ≥ 99% of every edge that carries one, but beside a loop', () => {
    track.segments.forEach((seg, i) => {
      for (const side of railSides(seg)) {
        const c = coverage(track, i, side)
        if (nextToLoop(track, i)) continue // checked below: only these may step aside
        expect(c, `${name} segment ${i} (${seg.type}) side ${side}`).toBeGreaterThanOrEqual(0.99)
      }
    })
  })

  it('are boxes RAIL.width thick standing on the road edge, RAIL.height tall over it at least', () => {
    const boxes = railBoxes(track)
    expect(boxes.length).toBeGreaterThan(0)
    for (const b of boxes) {
      expect(b.halfWidth).toBeCloseTo(RAIL.width / 2, 9)
      expect(b.height).toBeGreaterThanOrEqual(RAIL.height - 1e-9)
    }
  })
})

describe('rail edges', () => {
  it('skip only gaps and loops, and a wallride’s wall side', () => {
    expect(railSides({ type: 'gap', length: 10 })).toEqual([])
    expect(railSides({ type: 'loop', radius: 15 } as never)).toEqual([])
    expect(railSides({ type: 'wallride', turn: 'left', radius: 30, angle: 90 })).toEqual([1])
    expect(railSides({ type: 'wallride', turn: 'right', radius: 30, angle: 90 })).toEqual([-1])
    expect(railSides({ type: 'straight', length: 10 })).toEqual([1, -1])
  })

  it('step aside beside a loop only where the run-in and run-out share the ground', () => {
    // The two loop tracks: their run-in and run-out straights lie side by side, so the inner edges lose rails…
    for (const name of ['looping', 'test-loop']) {
      const track = load(name)
      const short = track.segments.flatMap((seg, i) => railSides(seg).map((side) => ({ i, side, c: coverage(track, i, side) }))).filter((e) => e.c < 0.99)
      expect(short.length, `${name} has a stretch without rails`).toBeGreaterThan(0)
      for (const e of short) expect(nextToLoop(track, e.i), `${name} segment ${e.i} side ${e.side} at ${e.c.toFixed(2)}`).toBe(true)
      // …and each such straight keeps its full rail on the outer edge.
      for (const e of short) expect(coverage(track, e.i, e.side === 1 ? -1 : 1)).toBeGreaterThanOrEqual(0.99)
    }
  })

  it('run along bridge decks and embankments', () => {
    // crossover's bridge over its start straight, and tower's raised road: raised rows exist and are railed.
    for (const name of ['crossover', 'tower']) {
      const track = load(name)
      const raised = planBodies(track)
        .map((plan, i) => ({ plan, i }))
        .filter((e) => e.plan)
      expect(raised.length, `${name} has raised road`).toBeGreaterThan(0)
      for (const { i } of raised) for (const side of railSides(track.segments[i])) expect(coverage(track, i, side), `${name} segment ${i}`).toBeGreaterThanOrEqual(0.99)
      const tops = railBoxes(track).map((b) => b.y)
      expect(Math.max(...tops), `${name} rails stand up on the raised road`).toBeGreaterThan(3)
    }
  })
})
