import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { poses, SEGMENT_TYPES, validate } from '../../track/schema'
import { FIXTURE_TRACK } from './fixture'
import { trackSurface } from '../../physics'
import type { Segment, Track } from '../../track/schema'
import { buildApron, buildDeck, buildRampSupport, buildTrack, CENTRE_COLUMN, DECK_MIN_HEIGHT, DECK_PILLAR_CLEAR, planDeckPillars, PROFILE, rowCenter, TRACK_WIDTH, sampleSegment, SURFACE_LIFT, type SegmentGeometry } from './geometry'

const geoms = buildTrack(FIXTURE_TRACK)
const ps = poses(FIXTURE_TRACK)
const segs = FIXTURE_TRACK.segments
const ROAD_HEIGHT = PROFILE[CENTRE_COLUMN][1]
const indexOf = (type: string) => segs.findIndex((s) => s.type === type)

const maxY = (g: SegmentGeometry) => {
  let m = -Infinity
  for (let i = 1; i < g.positions.length; i += 3) m = Math.max(m, g.positions[i])
  return m
}

describe('render track geometry', () => {
  it('fixture is a valid track covering every segment type', () => {
    expect(validate(FIXTURE_TRACK)).toEqual([])
    for (const t of SEGMENT_TYPES) expect(indexOf(t), t).toBeGreaterThanOrEqual(0)
  })

  it('builds at least 100 triangles for every segment', () => {
    geoms.forEach((g, i) => expect(g.indices.length / 3, segs[i].type).toBeGreaterThanOrEqual(100))
  })

  it('has no NaN vertices and in-range indices', () => {
    for (const g of geoms) {
      expect(g.positions.every(Number.isFinite)).toBe(true)
      expect(Math.max(...g.indices)).toBeLessThan(g.positions.length / 3)
    }
  })

  it('surface faces up on a flat straight', () => {
    const g = geoms[0]
    const p = (i: number) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]]
    const [a, b, c] = [p(g.indices[0]), p(g.indices[1]), p(g.indices[2])]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0) // normal.y
  })

  it('every segment exit edge meets the next poses() entry within 1 cm', () => {
    geoms.forEach((g, i) => {
      const [x, y, z] = rowCenter(g, g.rows - 1)
      const next = ps[i + 1]
      expect(Math.hypot(x - next.x, y - SURFACE_LIFT - ROAD_HEIGHT - next.y, z - next.z), segs[i].type).toBeLessThan(0.01)
    })
  })

  it('ramp rises by its rise and drop falls by its fall', () => {
    const r = indexOf('ramp')
    const d = indexOf('drop')
    const ramp = segs[r] as { rise: number }
    const drop = segs[d] as { fall: number }
    expect(rowCenter(geoms[r], geoms[r].rows - 1)[1] - rowCenter(geoms[r], 0)[1]).toBeCloseTo(ramp.rise, 3)
    expect(rowCenter(geoms[d], 0)[1] - rowCenter(geoms[d], geoms[d].rows - 1)[1]).toBeCloseTo(drop.fall, 3)
    expect(maxY(geoms[r])).toBeGreaterThan(ps[r].y + ramp.rise)
  })

  it('banked turn surface matches the physics surface (src/track/bank.ts)', () => {
    const b = indexOf('banked')
    const seg = segs[b] as Segment & { type: 'banked' }
    const surf = trackSurface({ ...FIXTURE_TRACK, segments: [seg], start: ps[b] }, { groundY: null })
    const g = geoms[b]
    for (let row = 0; row < g.rows; row++) {
      for (let c = 0; c < g.perRow; c++) {
        const i = (row * g.perRow + c) * 3
        const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]]
        const hit = surf.raycast({ x, y: y + 5, z }, { x: 0, y: -1, z: 0 }, 20)
        // Physics drives the road plane; the drawn profile sits PROFILE[c][1] above it.
        if (hit) expect(y - SURFACE_LIFT - PROFILE[c][1] - (y + 5 - hit.distance), `row ${row} col ${c}`).toBeCloseTo(0, 3)
      }
    }
  })

  it('banked turn starts and ends flat, reaching its full bank mid-turn', () => {
    const b = indexOf('banked')
    const seg = segs[b] as { bank: number }
    expect(sampleSegment(ps[b], segs[b], 0).roll).toBe(0)
    expect(sampleSegment(ps[b], segs[b], 1).roll).toBe(0)
    expect(sampleSegment(ps[b], segs[b], 0.5).roll).toBeCloseTo(seg.bank, 9)
  })

  it('banked apron rises from the dipped inner edge to the road plane, and the skirt drops to it', () => {
    const b = indexOf('banked')
    const apron = buildApron(ps[b], segs[b])!
    const y = (row: number, k: number) => apron.positions[(row * apron.perRow + k) * 3 + 1] - SURFACE_LIFT
    const mid = Math.floor(apron.rows / 2)
    expect(y(mid, 0)).toBeLessThan(ps[b].y - 0.5) // inner edge dips mid-turn
    expect(y(mid, 1)).toBeCloseTo(ps[b].y, 6) // apron rim on the road plane
    expect(y(mid, 2)).toBeGreaterThan(ps[b].y + 0.5) // outer edge raised
    expect(y(mid, 3)).toBeCloseTo(ps[b].y, 6) // skirt foot on the road plane
    expect(buildApron(ps[0], segs[0])).toBeNull()
  })

  it('procedural cross-section matches the Kenney straight: road, curbs, grass shoulders', () => {
    const bands = PROFILE.map(([, , b]) => b)
    expect(bands[0]).toBe('grass')
    expect(bands[bands.length - 1]).toBe('grass')
    const road = PROFILE.filter(([, , b]) => b === 'road').map(([u]) => u)
    expect(Math.max(...road) - Math.min(...road)).toBeCloseTo(6.9, 6) // Kenney road band, ±3.45 m
    expect(Math.max(...PROFILE.map(([u]) => u))).toBe(TRACK_WIDTH / 2)
  })

  it('banked apron is zero-width at both joints, so it never pokes past the neighbouring segments', () => {
    const b = indexOf('banked')
    const apron = buildApron(ps[b], segs[b])!
    const at = (row: number, k: number) => apron.positions.slice((row * apron.perRow + k) * 3, (row * apron.perRow + k) * 3 + 3)
    for (const row of [0, apron.rows - 1]) {
      const [ix, , iz] = at(row, 0)
      const [rx, , rz] = at(row, 1)
      expect(Math.hypot(rx - ix, rz - iz), `row ${row}`).toBeLessThan(1e-6)
    }
  })
})

describe('ramp supports', () => {
  const lap = JSON.parse(readFileSync('assets/track/lap2.json', 'utf8')) as Track
  const entries = poses(lap)

  it('walls only under ramps and drops, feet on the ground, tops at the road edge height', () => {
    lap.segments.forEach((seg, i) => {
      const g = buildRampSupport(entries[i], seg)
      if (seg.type !== 'ramp' && seg.type !== 'drop') return expect(g).toBeNull()
      expect(g).not.toBeNull()
      const y = (r: number, k: number) => g!.positions[(r * g!.perRow + k) * 3 + 1]
      for (let r = 0; r < g!.rows; r++) {
        const p = sampleSegment(entries[i], seg, r / (g!.rows - 1))
        expect(y(r, 1)).toBe(0)
        expect(y(r, 3)).toBe(0)
        expect(y(r, 0)).toBeCloseTo(p.y, 5)
        expect(y(r, 2)).toBeCloseTo(p.y, 5)
      }
    })
  })
})

describe('ramp profile', () => {
  it('is linear like the physics strip (src/physics/surface.ts), so the foot joint has no bump', () => {
    const entry = { x: 0, y: 0, z: 0, heading: 0 }
    for (const seg of [{ type: 'ramp', length: 30, rise: 7.8 }, { type: 'drop', length: 30, fall: 7.8 }] as Segment[]) {
      const dy = seg.type === 'ramp' ? 7.8 : -7.8
      for (const t of [0, 0.1, 0.5, 0.9, 1]) expect(sampleSegment(entry, seg, t).y).toBeCloseTo(dy * t, 6)
    }
  })
})

describe('multi-level decks', () => {
  const load = (name: string) => JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as Track
  const road = (track: Track) => {
    const ps = poses(track)
    return track.segments.flatMap((seg, i) =>
      seg.type === 'gap' ? [] : Array.from({ length: 41 }, (_, k) => ({ ...sampleSegment(ps[i], seg, k / 40), seg: i })),
    )
  }

  it.each(['crossover', 'tower'])('%s: every elevated flat piece gets a deck, gaps and ground pieces none', (name) => {
    const track = load(name)
    const ps = poses(track)
    track.segments.forEach((seg, i) => {
      const flat = seg.type !== 'ramp' && seg.type !== 'drop' && seg.type !== 'gap'
      expect(buildDeck(ps[i], seg) !== null, `seg ${i} ${seg.type} at y ${ps[i].y}`).toBe(flat && ps[i].y >= DECK_MIN_HEIGHT)
    })
  })

  it.each(['crossover', 'tower'])('%s: deck pillars stand on open ground, never on the road underneath', (name) => {
    const track = load(name)
    const pillars = planDeckPillars(track)
    expect(pillars.length).toBeGreaterThan(5)
    for (const p of pillars) {
      for (const q of road(track)) {
        if (q.y < p.top - 1) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThanOrEqual(DECK_PILLAR_CLEAR)
      }
    }
  })

  it.each(['lap1', 'lap2', 'crossover', 'tower'])('%s: no ramp or drop wall stands on another part of the lap', (name) => {
    const track = load(name)
    const pts = road(track)
    for (const a of pts.filter((p) => ['ramp', 'drop'].includes(track.segments[p.seg].type))) {
      for (const b of pts) {
        if (Math.abs(a.seg - b.seg) > 1 && b.y < a.y - 1) expect(Math.hypot(a.x - b.x, a.z - b.z), `seg ${a.seg} over ${b.seg}`).toBeGreaterThanOrEqual(TRACK_WIDTH)
      }
    }
  })
})
