// Per-segment road width: the track format's `width` (a number, or an [entry, exit] taper) and
// the one widthAt() that physics, render, gates, walls and the kit read it through.
import { describe, expect, it } from 'vitest'
import { trackSurface, v3 } from '../physics'
import { compileKit } from './kit'
import { LOOP_SHIFT } from './pose'
import { barrierPillars, gatePillars, gateWidth, MAX_ROAD_WIDTH, MIN_ROAD_WIDTH, ROAD_WIDTH, validate, widthAt, type Segment, type Track } from './schema'

const track = (segments: Segment[], extra: Partial<Track> = {}): Track => ({ name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments, gates: [], ...extra })
const material = (t: Track, x: number, z: number) => trackSurface(t).raycast(v3(x, 5, z), v3(0, -1, 0), 10)?.material ?? 'road'

describe('widthAt', () => {
  it('is ROAD_WIDTH by default, a loop one LOOP_SHIFT lane, and a set width all along', () => {
    expect(widthAt({ type: 'straight', length: 20 }, 0.5)).toBe(ROAD_WIDTH)
    expect(widthAt({ type: 'loop', turn: 'left', radius: 15 }, 0.5)).toBe(LOOP_SHIFT)
    expect(widthAt({ type: 'curve', turn: 'left', radius: 30, angle: 90, width: 20 }, 0.3)).toBe(20)
  })

  it('tapers [entry, exit] linearly along the segment', () => {
    const seg: Segment = { type: 'straight', length: 40, width: [10, 20] }
    expect(widthAt(seg, 0)).toBe(10)
    expect(widthAt(seg, 0.25)).toBe(12.5)
    expect(widthAt(seg, 1)).toBe(20)
  })
})

describe('validate width', () => {
  it('accepts a width or a taper in range', () => {
    expect(validate(track([{ type: 'straight', length: 20, width: 20 }]))).toEqual([])
    expect(validate(track([{ type: 'straight', length: 20, width: [MIN_ROAD_WIDTH, MAX_ROAD_WIDTH] }]))).toEqual([])
  })

  it('rejects a width out of range, a malformed taper, no road inside a turn, and a loop wider than its lane', () => {
    expect(validate(track([{ type: 'straight', length: 20, width: MIN_ROAD_WIDTH - 1 }]))).toHaveLength(1)
    expect(validate(track([{ type: 'straight', length: 20, width: [14] as unknown as [number, number] }]))).toHaveLength(1)
    expect(validate(track([{ type: 'hairpin', turn: 'left', radius: 10, width: 20 }]))[0]).toMatch(/no road inside radius/)
    expect(validate(track([{ type: 'loop', turn: 'left', radius: 15, width: 14 }]))[0]).toMatch(/at most 10 m/)
  })
})

describe('the road follows its width', () => {
  it('physics drives the full width of a wide segment and stops at its edge, along a taper too', () => {
    const t = track([{ type: 'straight', length: 40, width: [10, 30] }])
    // At 3/4 along the road is 25 m wide: road out to ±12.5 m, open ground past it.
    expect(material(t, 12, 30)).toBe('road')
    expect(material(t, 13, 30)).toBe('offroad')
    // At the entry it is 10 m: open ground already at 6 m.
    expect(material(t, 4.5, 0.5)).toBe('road')
    expect(material(t, 6, 0.5)).toBe('offroad')
  })

  it('gate pillars stand just off the road edge and a crossing counts across the whole road', () => {
    for (const width of [10, 14, 24]) {
      const t = track([{ type: 'straight', length: 40, width }], { gates: [{ kind: 'checkpoint', segment: 0 }] })
      expect(gateWidth(t, t.gates[0])).toBe(width)
      for (const p of gatePillars(t, t.gates[0])) expect(Math.abs(p.x) - p.halfWidth).toBeGreaterThan(width / 2)
    }
  })

  it('a road-following wall keeps its gap off the road edge where the road widens', () => {
    const t = track([{ type: 'straight', length: 40, width: [10, 20] }], { barriers: [{ segment: 0, side: 'left', gap: 0 }] })
    const walls = barrierPillars(t)
    expect(walls[0].x).toBeCloseTo((widthAt(t.segments[0], walls[0].z / 40) / 2) + 0.5, 6)
    expect(walls[walls.length - 1].x).toBeGreaterThan(walls[0].x)
  })

  it('a kit piece takes a width, and a taper is split over its segments by length', () => {
    const { track: t } = compileKit({ name: 'k', kit: { start: { cell: [0, 0], level: 0, dir: 0 }, pieces: [
      { piece: 'start' }, { piece: 'bump', width: [14, 18] }, { piece: 'straight-2', width: 18 }, { piece: 'straight-2', width: [18, 14] },
      { piece: 'hairpin', turn: 'left' }, { piece: 'straight-2' }, { piece: 'straight-2' }, { piece: 'straight-2' }, { piece: 'straight-1' }, { piece: 'straight-1' }, { piece: 'hairpin', turn: 'left' },
    ] } })
    // bump = ramp + drop of equal length: 14 → 16 → 18.
    expect([widthAt(t.segments[1], 0), widthAt(t.segments[1], 1), widthAt(t.segments[2], 1)]).toEqual([14, 16, 18])
    expect(widthAt(t.segments[3], 0.5)).toBe(18)
    expect(widthAt(t.segments[5], 0)).toBe(ROAD_WIDTH)
  })
})
