import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CELL, isEffect, isPad, padForward, poses, ROAD_WIDTH, turnCentre, type Segment, type Track, type Zone } from '../../track/schema'
import { createCarAt, trackSurface, type CarState } from '../../physics'
import { dustIntensity, DustPool } from '../fx/dust'
import { effectIcon } from './effect-pads'
import { buildSegment, type SegmentGeometry } from './geometry'
import { CHEVRON_PITCH, CHEVRON_SPAN, EDGE_FADE, MIN_CHEVRONS, ROAD_HALF_WIDTH, ROAD_TOP, SURFACE_OVERRUN, surfaceJoins, surfacePatch, padWidth, turboChevrons, turboPadWidth, valueNoise, ZONE_LIFT, ZONE_WIDTH, zoneQuad } from './zones'

// Asphalt half width on a default-width segment: ROAD_HALF_WIDTH (a CELL-wide road) stretched by ROAD_WIDTH / CELL.
const HALF = (ROAD_HALF_WIDTH * ROAD_WIDTH) / CELL

const lap2 = JSON.parse(readFileSync(new URL('../../../assets/track/test2.json', import.meta.url), 'utf8')) as Track

// Positions are float32, so world-space checks use a 0.1 mm tolerance.
// Lateral offset and distance along the segment of every vertex in a position buffer.
const local = (track: Track, zone: Zone, positions: Float32Array) => {
  const e = poses(track)[zone.segment]
  const fx = Math.sin(e.heading)
  const fz = Math.cos(e.heading)
  const out: { lat: number; along: number; dy: number }[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const rx = positions[i] - e.x
    const rz = positions[i + 2] - e.z
    out.push({ lat: rx * fz - rz * fx, along: rx * fx + rz * fz, dy: positions[i + 1] - e.y })
  }
  return out
}

describe('lap2 zone decals', () => {
  const zones = lap2.zones ?? []

  it('has zones to check', () => expect(zones.length).toBeGreaterThan(0))

  it.each(zones.map((z) => [`${z.kind} on segment ${z.segment}`, z] as const))('%s lies on the asphalt, between the curbs', (_name, zone) => {
    const seg = lap2.segments[zone.segment]
    const length = 'length' in seg ? seg.length : 0
    const kind = zone.kind
    const buffers =
      kind === 'turbo' || kind === 'turbo-red'
        ? [zoneQuad(lap2, zone), turboChevrons(lap2, zone)]
        : isEffect(kind)
          ? [zoneQuad(lap2, zone), effectIcon(lap2, { ...zone, kind }, ZONE_WIDTH, ZONE_LIFT + 0.002)]
          : [surfacePatch(lap2, { ...zone, kind }).positions]
    for (const b of buffers) {
      for (const p of local(lap2, zone, b)) {
        expect(Math.abs(p.lat)).toBeLessThanOrEqual(HALF + 1e-4)
        expect(p.along).toBeGreaterThanOrEqual(-1e-4)
        expect(p.along).toBeLessThanOrEqual(length + 1e-4)
        // Just above the road top: never coplanar with it, never a visible lift.
        expect(p.dy).toBeGreaterThan(ROAD_TOP)
        expect(p.dy).toBeLessThanOrEqual(ROAD_TOP + 0.005 + 1e-9)
      }
    }
  })

  it('turbo pads sit over their physics extent along the road', () => {
    for (const zone of zones.filter((z) => z.kind === 'turbo' || z.kind === 'turbo-red')) {
      const seg = lap2.segments[zone.segment]
      const length = 'length' in seg ? seg.length : 0
      const along = local(lap2, zone, zoneQuad(lap2, zone)).map((p) => p.along)
      expect(Math.min(...along)).toBeCloseTo(zone.from * length, 3)
      expect(Math.max(...along)).toBeCloseTo(zone.to * length, 3)
    }
  })
})

// Every shipped track, so a pad added to any lap is checked too.
const trackDir = new URL('../../../assets/track/', import.meta.url)
const shipped = readdirSync(trackDir)
  .filter((f) => f.endsWith('.json') && f !== 'pieces.json')
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, trackDir), 'utf8')) as Track] as const)
  .filter(([, t]) => Array.isArray(t.segments))

// Each chevron is (left, right, tip): tip minus the base midpoint is where it points.
const chevronDirs = (positions: Float32Array): [number, number][] => {
  const out: [number, number][] = []
  // One chevron per 12 vertices: 0 left outer back corner, 2 the outer tip, 7 the right outer back corner.
  for (let i = 0; i < positions.length; i += 36) {
    const bx = (positions[i] + positions[i + 21]) / 2
    const bz = (positions[i + 2] + positions[i + 23]) / 2
    const dx = positions[i + 6] - bx
    const dz = positions[i + 8] - bz
    const l = Math.hypot(dx, dz)
    out.push([dx / l, dz / l])
  }
  return out
}

describe('turbo pad arrows', () => {
  const pads = shipped.flatMap(([file, t]) => (t.zones ?? []).filter((z) => isPad(z.kind)).map((z) => [`${file} ${z.kind} on segment ${z.segment}`, t, z] as const))

  it('shipped tracks carry pads to check', () => expect(pads.length).toBeGreaterThan(0))

  it.each(pads)('%s: every chevron points where the pad boosts', (_name, track, zone) => {
    const [fx, fz] = padForward(track, zone)
    for (const [dx, dz] of chevronDirs(turboChevrons(track, zone))) expect(dx * fx + dz * fz).toBeCloseTo(1, 4)
  })

  it('a reversed pad points its chevrons back down the segment', () => {
    const zone = { kind: 'turbo' as const, segment: 0, from: 0.2, to: 0.4 }
    const track: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0.3 }, segments: [{ type: 'straight', length: 100 }], gates: [], zones: [zone] }
    const fwd = chevronDirs(turboChevrons(track, zone))
    const back = chevronDirs(turboChevrons(track, { ...zone, reverse: true }))
    const [fx, fz] = padForward(track, { ...zone, reverse: true })
    for (let i = 0; i < fwd.length; i++) {
      expect(fwd[i][0] * back[i][0] + fwd[i][1] * back[i][1]).toBeCloseTo(-1, 4)
      expect(back[i][0] * fx + back[i][1] * fz).toBeCloseTo(1, 4)
    }
  })
})

describe('bold turbo pads', () => {
  const zone = { kind: 'turbo' as const, segment: 0, from: 0.2, to: 0.4 }
  const track: Track = { name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'straight', length: 100 }], gates: [], zones: [zone] }

  it('span the asphalt between the curbs', () => {
    const q = zoneQuad(track, zone, turboPadWidth(track, zone))
    const xs = Array.from({ length: q.length / 3 }, (_, i) => q[i * 3])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(padWidth(track, zone) + 0.5 - 0.1, 3) // the asphalt there, less 0.1 m
  })

  it('carry one bold V chevron per CHEVRON_PITCH metres, wide across the pad', () => {
    const c = turboChevrons(track, zone)
    expect(c.length / 36).toBe(Math.round(20 / CHEVRON_PITCH))
    const xs = Array.from({ length: c.length / 3 }, (_, i) => c[i * 3])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(turboPadWidth(track, zone) * CHEVRON_SPAN, 3)
  })

  it('a short pad still gets MIN_CHEVRONS', () => {
    expect(turboChevrons(track, { ...zone, to: 0.21 }).length / 36).toBe(MIN_CHEVRONS)
  })
})

describe('surface patch', () => {
  const zone = { kind: 'dirt' as const, segment: 3, from: 0.4, to: 0.85 }
  const patch = surfacePatch(lap2, zone)
  const alpha = (i: number) => patch.colors[i * 4 + 3]
  const n = patch.positions.length / 3

  it('fades to transparent at its edges and is opaque inside', () => {
    const pts = local(lap2, zone, patch.positions)
    const edges = pts.map((p, i) => ({ p, i })).filter(({ p }) => Math.abs(Math.abs(p.lat) - HALF) < 1e-4)
    expect(edges.length).toBeGreaterThan(0)
    for (const { i } of edges) expect(alpha(i)).toBe(0)
    // Opaque over the whole physics extent along the road (the fade lives in the overrun), away from the sides.
    const length = 120
    const inner = pts
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Math.abs(p.lat) < HALF - EDGE_FADE && p.along >= zone.from * length && p.along <= zone.to * length)
    expect(inner.length).toBeGreaterThan(100)
    expect(inner.every(({ i }) => alpha(i) > 0.99)).toBe(true)
  })

  it('has a ragged border, not a straight line', () => {
    // Along one side, the distance in from the edge where alpha first reaches 0.5 varies.
    const pts = local(lap2, zone, patch.positions)
    const reach = new Map<number, number>()
    pts.forEach((p, i) => {
      const key = Math.round(p.along * 10)
      if (p.lat > 0 && alpha(i) >= 0.5) reach.set(key, Math.max(reach.get(key) ?? -Infinity, p.lat))
    })
    const values = [...reach.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.2)
  })

  it('mottles its colour and differs per surface', () => {
    const lum = (c: Float32Array, i: number) => c[i * 4] + c[i * 4 + 1] + c[i * 4 + 2]
    const values = Array.from({ length: n }, (_, i) => lum(patch.colors, i))
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.1)
    const ice = surfacePatch(lap2, { ...zone, kind: 'ice' })
    // Ice is far brighter and bluer than dirt.
    const mean = (c: Float32Array, k: number) => Array.from({ length: n }, (_, i) => c[i * 4 + k]).reduce((a, b) => a + b) / n
    expect(mean(ice.colors, 2)).toBeGreaterThan(mean(patch.colors, 2) + 0.4)
    expect(mean(ice.colors, 2)).toBeGreaterThan(mean(ice.colors, 0))
    expect(mean(patch.colors, 0)).toBeGreaterThan(mean(patch.colors, 2))
  })

  it('value noise is deterministic and in 0..1', () => {
    expect(valueNoise(1.3, 2.7, 4)).toBe(valueNoise(1.3, 2.7, 4))
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * 0.11, 2)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('decal lift stays at most 5 mm over the road top', () => {
    expect(ZONE_LIFT - ROAD_TOP).toBeGreaterThan(0)
    expect(ZONE_LIFT - ROAD_TOP).toBeLessThanOrEqual(0.005)
  })
})

// Surface zones on curves, hairpins and banks: the patch follows the arc and the bank roll.
describe('surface patch on arcs', () => {
  const arcs: Segment[] = [
    { type: 'curve', turn: 'left', radius: 10, angle: 90 },
    { type: 'curve', turn: 'right', radius: 30, angle: 90 },
    { type: 'hairpin', turn: 'left', radius: 10 },
    { type: 'banked', turn: 'right', radius: 20, angle: 180, bank: 0.26 },
    { type: 'banked', turn: 'left', radius: 20, angle: 90, bank: 0.26 },
  ]
  const start = { x: 5, y: 4, z: -3, heading: 0.4 }
  const name = (seg: Segment) => `${seg.type} ${'turn' in seg ? seg.turn : ''} r${'radius' in seg ? seg.radius : ''}`

  // Height of the drawn road mesh (buildSegment) at (x, z): the lowest triangle containing it, so a
  // patch edge on the road/curb step reads the asphalt, not the curb top.
  const drawnRoadY = (geo: SegmentGeometry, x: number, z: number): number | null => {
    const p = geo.positions
    const at = (i: number) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
    let best: number | null = null
    for (let k = 0; k < geo.indices.length; k += 3) {
      const [a, b, c] = [at(geo.indices[k]), at(geo.indices[k + 1]), at(geo.indices[k + 2])]
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
      if (Math.abs(det) < 1e-12) continue
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det
      const l3 = 1 - l1 - l2
      if (l1 >= -1e-4 && l2 >= -1e-4 && l3 >= -1e-4) {
        const y = l1 * a[1] + l2 * b[1] + l3 * c[1]
        if (best === null || y < best) best = y
      }
    }
    return best
  }

  it.each(arcs.map((seg) => [name(seg), seg] as const))('%s: every vertex lies on the asphalt, 3 mm over the drawn road, where physics reads the zone', (_name, seg) => {
    const zone = { kind: 'ice' as const, segment: 0, from: 0, to: 1 }
    const track: Track = { name: 't', start, segments: [seg], gates: [], zones: [zone] }
    const physics = trackSurface(track, { groundY: null })
    const geo = buildSegment(start, seg)
    const radius = 'radius' in seg ? seg.radius : 0
    const [cx, cz] = turnCentre(start, 'turn' in seg ? seg.turn : 'left', radius)
    const { positions } = surfacePatch(track, zone)
    expect(positions.length / 3).toBeGreaterThan(100)
    const cols = Math.round((2 * ROAD_HALF_WIDTH) / 0.3) + 1
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]]
      // Rows are chords of the arc like the road mesh's, so allow the chord sag.
      expect(Math.abs(Math.hypot(x - cx, z - cz) - radius)).toBeLessThanOrEqual(HALF + 0.05)
      const roadY = drawnRoadY(geo, x, z)
      expect(roadY, `vertex ${i / 3} over the road mesh`).not.toBeNull()
      expect(y - roadY!).toBeGreaterThan(0.002)
      expect(y - roadY!).toBeLessThan(0.004)
      // The first and last rows sit on the piece's end lines, where a single-piece raycast can fall a
      // rounding error outside the sector; every vertex between must read the zone's material.
      const hit = physics.raycast({ x, y: y + 2, z }, { x: 0, y: -1, z: 0 }, 10)
      const endRow = i / 3 < cols || i / 3 >= positions.length / 3 - cols
      if (!endRow) expect(hit?.material, `vertex ${i / 3}`).toBe('ice')
    }
  })

  it('a partial zone on a hairpin overruns its physics extent by SURFACE_OVERRUN and fades out at both ends', () => {
    const seg: Segment = { type: 'hairpin', turn: 'right', radius: 15 }
    const zone = { kind: 'dirt' as const, segment: 0, from: 0.2, to: 0.8 }
    const track: Track = { name: 't', start, segments: [seg], gates: [], zones: [zone] }
    const patch = surfacePatch(track, zone)
    const cols = Math.round((2 * ROAD_HALF_WIDTH) / 0.3) + 1
    const rows = patch.positions.length / 3 / cols
    const [cx, cz] = turnCentre(start, 'right', 15)
    // Sweep fraction of a row's centre vertex: its angle about the turn centre over the hairpin's π.
    const fraction = (row: number) => {
      const i = (row * cols + Math.floor(cols / 2)) * 3
      const a0 = Math.atan2(start.x - cx, start.z - cz)
      const a = Math.atan2(patch.positions[i] - cx, patch.positions[i + 2] - cz)
      return Math.abs(((a - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) / Math.PI
    }
    const pad = SURFACE_OVERRUN / (15 * Math.PI)
    expect(fraction(0)).toBeCloseTo(0.2 - pad, 2)
    expect(fraction(rows - 1)).toBeCloseTo(0.8 + pad, 2)
    for (const row of [0, rows - 1]) for (let c = 0; c < cols; c++) expect(patch.colors[(row * cols + c) * 4 + 3]).toBe(0)
  })

  // A straight → curve → straight dirt run, then plain road, then a dirt piece on the last segment.
  const run: Track = {
    name: 't',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [
      { type: 'straight', length: 20 },
      { type: 'curve', turn: 'left', radius: 20, angle: 90 },
      { type: 'straight', length: 20 },
      { type: 'straight', length: 20 },
      { type: 'straight', length: 20 },
    ],
    gates: [],
    zones: [0, 1, 2, 4].map((k) => ({ kind: 'dirt' as const, segment: k, from: 0, to: 1 })),
  }
  const zones = run.zones!
  const patches = zones.map((z) => surfacePatch(run, { ...z, kind: 'dirt' }))
  const cols = Math.round((2 * ROAD_HALF_WIDTH) / 0.3) + 1
  const rowCountOf = (k: number) => patches[k].positions.length / 3 / cols
  const centreAlpha = (k: number, row: 'first' | 'last') => patches[k].colors[((row === 'first' ? 0 : rowCountOf(k) - 1) * cols + Math.floor(cols / 2)) * 4 + 3]

  it('joins a run of same-surface pieces, never across the start line', () => {
    expect(zones.map((z) => surfaceJoins(run, z))).toEqual([
      { start: false, end: true },
      { start: true, end: true },
      { start: true, end: false },
      // Segment 4 runs into segment 0 across the start line: not joined, it fades out there.
      { start: false, end: false },
    ])
    expect(centreAlpha(0, 'first')).toBe(0)
    expect(centreAlpha(2, 'last')).toBe(0)
    expect(centreAlpha(3, 'last')).toBe(0)
    for (const k of [0, 1]) expect(centreAlpha(k, 'last')).toBeGreaterThan(0.99)
    for (const k of [1, 2]) expect(centreAlpha(k, 'first')).toBeGreaterThan(0.99)
  })

  it('a joined pair meets without a seam: the shared row has the same position and colour on both sides', () => {
    for (const k of [0, 1]) {
      const a = patches[k]
      const b = patches[k + 1]
      const last = (rowCountOf(k) - 1) * cols
      for (let c = 0; c < cols; c++) {
        for (let d = 0; d < 3; d++) expect(Math.abs(a.positions[(last + c) * 3 + d] - b.positions[c * 3 + d])).toBeLessThan(1e-4)
        for (let d = 0; d < 4; d++) expect(Math.abs(a.colors[(last + c) * 4 + d] - b.colors[c * 4 + d])).toBeLessThan(1e-4)
      }
    }
  })
})

describe('dust', () => {
  const moving = (v: number): CarState => ({ ...createCarAt({ x: 0, y: 0, z: 0, heading: 0 }), velocity: { x: 0, y: 0, z: v } })

  it('comes off dirt, less off grass, never off road or ice', () => {
    const s = moving(20)
    expect(dustIntensity(s, 'dirt')).toBeGreaterThan(dustIntensity(s, 'grass'))
    expect(dustIntensity(s, 'grass')).toBeGreaterThan(0)
    expect(dustIntensity(s, 'road')).toBe(0)
    expect(dustIntensity(s, 'ice')).toBe(0)
    expect(dustIntensity(moving(1), 'dirt')).toBe(0)
  })

  it('a car driving on dirt leaves puffs behind it that age out', () => {
    const pool = new DustPool()
    for (let i = 0; i < 60; i++) pool.update(moving(20), 'dirt', 1 / 60)
    expect(pool.puffs.length).toBeGreaterThan(30)
    expect(pool.puffs.every((p) => p.z < 0.5)).toBe(true) // behind the rear axle at z 0
    for (let i = 0; i < 120; i++) pool.update(moving(20), 'road', 1 / 60)
    expect(pool.puffs.length).toBe(0)
  })
})
