import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { CAMPAIGN, menuOrder, STYLES, TEST_TRACKS } from '../../track/catalogue'
import { gatePillars, poses, SEGMENT_TYPES, validate } from '../../track/schema'
import { turnSign } from '../../track/pose'
import { FIXTURE_TRACK } from '../../track/fixture'
import { resolveTrack } from '../../track/kit'
import { trackSurface } from '../../physics'
import type { Segment, Track } from '../../track/schema'
import { buildApron, buildBody, buildDeck, buildTrack, CENTRE_COLUMN, DECK_DEPTH, DECK_PILLAR_CLEAR, GATE_FOOTING_MIN_HEIGHT, lateralPoint, planBodies, planDeckPillars, planGateFootings, PROFILE, RAISED_MIN, rowCenter, rowCount, SPAN_HEADROOM, TRACK_WIDTH, sampleSegment, SURFACE_LIFT, type SegmentGeometry } from './geometry'

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

// Every shipped track in menu order: campaign, styles, test tracks (src/track/catalogue.ts).
const CATALOGUE = menuOrder(readdirSync('assets/track').filter((f) => f.endsWith('.json') && f !== 'pieces.json').map((f) => f.slice(0, -'.json'.length)))
const loadTrack = (name: string) => resolveTrack(JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8'))) as Track
const vertex = (g: SegmentGeometry, v: number): [number, number, number] => [g.positions[3 * v], g.positions[3 * v + 1], g.positions[3 * v + 2]]

describe('raised bodies', () => {
  it('covers the whole catalogue', () => {
    expect(CATALOGUE).toEqual(expect.arrayContaining(['crossover', 'tower', 'plunge', 'knot', 'leap', 'switchback', 'flatout', 'dustbowl', 'glacier', 'washboard', 'looping', 'test1', 'test2', 'test-ramp']))
  })

  it.each(CATALOGUE)('%s: every raised row stands on a solid body to the ground or is a bridge deck', (name) => {
    const track = loadTrack(name)
    const ps = poses(track)
    const plans = planBodies(track)
    track.segments.forEach((seg, i) => {
      if (seg.type === 'gap' || seg.type === 'loop') return expect(plans[i]).toBeNull()
      const rows = rowCount(seg)
      const samples = Array.from({ length: rows }, (_, r) => sampleSegment(ps[i], seg, r / (rows - 1)))
      if (!samples.some((p) => p.y > RAISED_MIN)) return expect(plans[i], `seg ${i} on the ground`).toBeNull()
      const plan = plans[i]!
      expect(plan.kinds).toHaveLength(rows)
      const body = buildBody(ps[i], seg, plan)
      const deck = buildDeck(ps[i], seg, plan.kinds)
      const tris = new Set<string>()
      for (let t = 0; t < body.indices.length; t += 3) tris.add([body.indices[t], body.indices[t + 1], body.indices[t + 2]].join())
      const s = turnSign(seg)
      samples.forEach((p, r) => {
        if (p.y <= RAISED_MIN) return
        const at = `${name} seg ${i} ${seg.type} row ${r} y ${p.y.toFixed(2)}`
        if (plan.kinds[r] === 'span') {
          expect(deck, at).not.toBeNull()
          const top = vertex(deck!, r * deck!.perRow)
          const foot = vertex(deck!, r * deck!.perRow + 1)
          expect(top[1] - foot[1], at).toBeGreaterThanOrEqual(0.3)
          return
        }
        // Filled: both wall feet on the ground, tops at the road edge, a body at least 0.3 m wide.
        const [lt, lf, rt, rf] = [0, 1, 2, 3].map((k) => vertex(body, r * body.perRow + k))
        expect(Math.abs(lf[1]), at).toBeLessThanOrEqual(0.05)
        expect(Math.abs(rf[1]), at).toBeLessThanOrEqual(0.05)
        if (seg.type !== 'banked') {
          expect(lt[1], at).toBeCloseTo(lateralPoint(p, TRACK_WIDTH / 2, s)[1], 3)
          expect(rt[1], at).toBeCloseTo(lateralPoint(p, -TRACK_WIDTH / 2, s)[1], 3)
        }
        expect(Math.hypot(lt[0] - rt[0], lt[2] - rt[2]), at).toBeGreaterThanOrEqual(0.3)
        // Walls join this row to each filled neighbour in the segment.
        const a = r * body.perRow
        if (r + 1 < rows && plan.kinds[r + 1] === 'fill') {
          const b = a + body.perRow
          expect(tris.has([a, a + 1, b].join()) && tris.has([a + 2, b + 2, a + 3].join()), `${at}: walls to the next row`).toBe(true)
          expect(tris.has([a + 4, b + 4, a + 5].join()), `${at}: lid to the next row`).toBe(true)
          // The lid closes the body just under the road edges, never above the road.
          for (const k of [4, 5]) expect(vertex(body, a + k)[1], at).toBeLessThan(Math.max(lt[1], rt[1]))
        }
      })
    })
  })

  it.each(CATALOGUE)('%s: every filled run ends in a cap down to the ground, never an open end', (name) => {
    const track = loadTrack(name)
    const ps = poses(track)
    const plans = planBodies(track)
    const n = track.segments.length
    const kindAt = (i: number, r: number) => plans[i]?.kinds[r] ?? null
    track.segments.forEach((seg, i) => {
      const plan = plans[i]
      if (!plan) return
      const rows = plan.kinds.length
      const body = buildBody(ps[i], seg, plan)
      const prev = (i - 1 + n) % n
      const next = (i + 1) % n
      plan.kinds.forEach((kind, r) => {
        if (kind !== 'fill') return
        const before = r > 0 ? kindAt(i, r - 1) : plans[prev] ? kindAt(prev, plans[prev]!.kinds.length - 1) : null
        const after = r < rows - 1 ? kindAt(i, r + 1) : plans[next] ? kindAt(next, 0) : null
        if (before === 'fill' && after === 'fill') return
        // A cap carries a foot vertex under the road centre; walls only ever stand at the edges.
        const p = sampleSegment(ps[i], seg, r / (rows - 1))
        let capped = false
        for (let v = rows * body.perRow; v < body.positions.length / 3; v++) {
          const [x, y, z] = vertex(body, v)
          if (y === 0 && Math.hypot(x - p.x, z - p.z) < 1e-3) capped = true
        }
        expect(capped, `${name} seg ${i} ${seg.type} row ${r}: run end without a cap`).toBe(true)
      })
    })
  })

  it.each(CATALOGUE)('%s: no filled body stands on a road passing underneath', (name) => {
    const track = loadTrack(name)
    const ps = poses(track)
    const plans = planBodies(track)
    const n = track.segments.length
    const road = track.segments.flatMap((seg, i) =>
      seg.type === 'gap' ? [] : Array.from({ length: 41 }, (_, k) => ({ ...sampleSegment(ps[i], seg, k / 40), seg: i })),
    )
    track.segments.forEach((seg, i) => {
      const plan = plans[i]
      if (!plan) return
      plan.kinds.forEach((kind, r) => {
        if (kind !== 'fill') return
        const p = sampleSegment(ps[i], seg, r / (plan.kinds.length - 1))
        let nearest = Infinity
        for (const q of road) {
          const apart = Math.min(Math.abs(q.seg - i), n - Math.abs(q.seg - i))
          if (apart > 1 && q.y < p.y - SPAN_HEADROOM) nearest = Math.min(nearest, Math.hypot(q.x - p.x, q.z - p.z))
        }
        expect(nearest, `${name} seg ${i} row ${r}: a lower road under a filled body`).toBeGreaterThanOrEqual(TRACK_WIDTH)
      })
    })
  })

  it("crossover's bridge over the start straight stays an open span on pillars, with abutments either side", () => {
    const track = loadTrack('crossover')
    const plans = planBodies(track)
    const spans = plans.flatMap((pl, i) => (pl?.kinds.includes('span') ? [i] : []))
    expect(spans).toEqual([5]) // the straight at y 8 crossing x 0
    expect(plans[5]!.kinds[0]).toBe('fill')
    expect(plans[5]!.kinds.at(-1)).toBe('fill')
    const pillars = planDeckPillars(track)
    expect(pillars.length).toBeGreaterThanOrEqual(1)
    for (const p of pillars) expect(Math.abs(p.x)).toBeGreaterThanOrEqual(DECK_PILLAR_CLEAR) // never on the start straight (x 0)
    expect(DECK_DEPTH).toBeGreaterThanOrEqual(0.3)
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
  // Kit tracks compile to a plain Track; spline tracks pass through.
  const load = (name: string) => resolveTrack(JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8'))) as Track
  const road = (track: Track) => {
    const ps = poses(track)
    return track.segments.flatMap((seg, i) =>
      seg.type === 'gap' ? [] : Array.from({ length: 41 }, (_, k) => ({ ...sampleSegment(ps[i], seg, k / 40), seg: i })),
    )
  }

  it.each(['crossover', 'tower', 'plunge', 'knot', 'leap'])('%s: decks and their pillars only where a road passes underneath', (name) => {
    const track = load(name)
    const ps = poses(track)
    const plans = planBodies(track)
    track.segments.forEach((seg, i) => {
      if (seg.type === 'loop') return
      expect(buildDeck(ps[i], seg, plans[i]?.kinds ?? null) !== null, `seg ${i} ${seg.type}`).toBe(plans[i]?.kinds.includes('span') ?? false)
    })
    for (const p of planDeckPillars(track)) {
      for (const q of road(track)) {
        if (q.y < p.top - 1) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThanOrEqual(DECK_PILLAR_CLEAR)
      }
    }
  })

  it.each(['test1', 'test2', 'crossover', 'tower', 'plunge', 'knot', 'leap'])('%s: no ramp or drop wall stands on another part of the lap', (name) => {
    const track = load(name)
    const pts = road(track)
    for (const a of pts.filter((p) => ['ramp', 'drop'].includes(track.segments[p.seg].type))) {
      for (const b of pts) {
        if (Math.abs(a.seg - b.seg) > 1 && b.y < a.y - 1) expect(Math.hypot(a.x - b.x, a.z - b.z), `seg ${a.seg} over ${b.seg}`).toBeGreaterThanOrEqual(TRACK_WIDTH)
      }
    }
  })

  // Every catalogue track: campaign, styles and the test group.
  const catalogue = [...CAMPAIGN.map((l) => l.track), ...STYLES.map((l) => l.track), ...TEST_TRACKS]

  it('every gate on an elevated deck stands on a footing reaching the ground', () => {
    const grounded: string[] = []
    for (const name of catalogue) {
      const track = load(name)
      const footings = planGateFootings(track)
      track.gates.forEach((gate, g) => {
        for (const p of gatePillars(track, gate)) {
          if (p.y < GATE_FOOTING_MIN_HEIGHT) continue
          const at = `${name} gate ${g} pillar at y ${p.y.toFixed(1)}`
          const f = footings.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.01)
          expect(f, at).toBeDefined()
          expect(f!.y, at).toBe(0) // stands on the ground
          expect(Math.abs(f!.y + f!.height - p.y), at).toBeLessThan(0.01) // reaches the pillar base
          expect(Math.abs(f!.halfWidth - p.halfWidth) + Math.abs(f!.halfDepth - p.halfDepth), at).toBeLessThan(0.01) // under the whole pillar
          expect(f!.heading, at).toBe(p.heading)
          grounded.push(`${name}#${g}`)
        }
      })
    }
    // Not vacuous: the reported crossover CP 2 is in the set, among at least five gates.
    expect(grounded).toContain('crossover#2')
    expect(new Set(grounded).size).toBeGreaterThanOrEqual(5)
  })

  it('no gate footing stands on a road passing underneath', () => {
    for (const name of catalogue) {
      const track = load(name)
      for (const f of planGateFootings(track)) {
        for (const q of road(track)) {
          if (q.y < f.height - 1) expect(Math.hypot(q.x - f.x, q.z - f.z), `${name} footing over seg ${q.seg}`).toBeGreaterThanOrEqual(TRACK_WIDTH / 2 + f.halfWidth)
        }
      }
    }
  })

  it('ground-level gates get no footing', () => {
    for (const name of catalogue) {
      const track = load(name)
      for (const f of planGateFootings(track)) expect(f.height, name).toBeGreaterThanOrEqual(GATE_FOOTING_MIN_HEIGHT)
    }
    expect(planGateFootings(load('test1'))).toEqual([])
  })
})
