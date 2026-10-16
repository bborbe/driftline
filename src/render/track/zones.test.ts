import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPad, padForward, poses, type Track, type Zone } from '../../track/schema'
import { createCarAt, type CarState } from '../../physics'
import { dustIntensity, DustPool } from '../fx/dust'
import { EDGE_FADE, ROAD_HALF_WIDTH, ROAD_TOP, surfacePatch, turboChevrons, valueNoise, ZONE_LIFT, zoneQuad } from './zones'

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
    const buffers =
      zone.kind === 'turbo' || zone.kind === 'turbo-red'
        ? [zoneQuad(lap2, zone), turboChevrons(lap2, zone)]
        : [surfacePatch(lap2, { ...zone, kind: zone.kind }).positions]
    for (const b of buffers) {
      for (const p of local(lap2, zone, b)) {
        expect(Math.abs(p.lat)).toBeLessThanOrEqual(ROAD_HALF_WIDTH + 1e-4)
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
  for (let i = 0; i < positions.length; i += 9) {
    const bx = (positions[i] + positions[i + 3]) / 2
    const bz = (positions[i + 2] + positions[i + 5]) / 2
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

describe('surface patch', () => {
  const zone = { kind: 'dirt' as const, segment: 3, from: 0.4, to: 0.85 }
  const patch = surfacePatch(lap2, zone)
  const alpha = (i: number) => patch.colors[i * 4 + 3]
  const n = patch.positions.length / 3

  it('fades to transparent at its edges and is opaque inside', () => {
    const pts = local(lap2, zone, patch.positions)
    const edges = pts.map((p, i) => ({ p, i })).filter(({ p }) => Math.abs(Math.abs(p.lat) - ROAD_HALF_WIDTH) < 1e-4)
    expect(edges.length).toBeGreaterThan(0)
    for (const { i } of edges) expect(alpha(i)).toBe(0)
    // Opaque over the whole physics extent along the road (the fade lives in the overrun), away from the sides.
    const length = 120
    const inner = pts
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Math.abs(p.lat) < ROAD_HALF_WIDTH - EDGE_FADE && p.along >= zone.from * length && p.along <= zone.to * length)
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
