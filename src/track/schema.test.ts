import { describe, expect, it } from 'vitest'
import { exitPose, layoutId, poses, validate, zoneCorners, type Pose, type Track } from './schema'

const origin: Pose = { x: 0, y: 0, z: 0, heading: 0 }

describe('exitPose', () => {
  it('advances a straight along +z at heading 0', () => {
    expect(exitPose(origin, { type: 'straight', length: 10 })).toEqual({ x: 0, y: 0, z: 10, heading: 0 })
  })

  it('turns a left 90° curve to heading +π/2', () => {
    const p = exitPose(origin, { type: 'curve', turn: 'left', radius: 10, angle: 90 })
    expect(p.heading).toBeCloseTo(Math.PI / 2)
    expect(p.x).toBeCloseTo(10)
    expect(p.z).toBeCloseTo(10)
  })

  it('reverses heading on a hairpin', () => {
    const p = exitPose(origin, { type: 'hairpin', turn: 'right', radius: 5 })
    expect(p.heading).toBeCloseTo(-Math.PI)
    expect(p.x).toBeCloseTo(-10)
    expect(p.z).toBeCloseTo(0)
  })

  it('turns a 180° banked right turn like a hairpin and keeps height', () => {
    const p = exitPose({ ...origin, y: 2 }, { type: 'banked', turn: 'right', radius: 5, angle: 180, bank: 0.3 })
    expect(p.heading).toBeCloseTo(-Math.PI)
    expect(p.x).toBeCloseTo(-10)
    expect(p.z).toBeCloseTo(0)
    expect(p.y).toBe(2)
  })

  it('turns a 90° banked left turn to heading +π/2', () => {
    const p = exitPose(origin, { type: 'banked', turn: 'left', radius: 15, angle: 90, bank: 0.26 })
    expect(p.heading).toBeCloseTo(Math.PI / 2)
    expect(p.x).toBeCloseTo(15)
    expect(p.z).toBeCloseTo(15)
  })

  it('lifts on a ramp and lowers on a drop', () => {
    const up = exitPose(origin, { type: 'ramp', length: 20, rise: 3 })
    expect(up.y).toBe(3)
    expect(exitPose(up, { type: 'drop', length: 20, fall: 3 }).y).toBe(0)
  })
})

describe('validate', () => {
  const ok: Track = {
    name: 'square',
    start: origin,
    segments: [
      { type: 'straight', length: 10 },
      { type: 'curve', turn: 'left', radius: 10, angle: 90 },
    ],
    gates: [{ kind: 'start-finish', segment: 0 }],
  }

  it('accepts a well-formed track', () => {
    expect(validate(ok)).toEqual([])
  })

  it('accepts a gap, and rejects a gate standing on one', () => {
    const gapped: Track = { ...ok, segments: [...ok.segments, { type: 'gap', length: 12, fall: 2 }] }
    expect(validate(gapped)).toEqual([])
    expect(validate({ ...gapped, gates: [...gapped.gates, { kind: 'checkpoint', segment: 2 }] })).toEqual([
      'gates[1]: a gate cannot stand on a gap (no road)',
    ])
  })

  it('rejects an unknown segment type', () => {
    expect(validate({ ...ok, segments: [{ type: 'corkscrew' }] })).toContain('segments[0]: unknown segment type corkscrew')
  })

  it('rejects a banked turn without a bank angle', () => {
    expect(validate({ ...ok, segments: [{ type: 'banked', turn: 'left', radius: 10, angle: 90 }] })).toEqual([
      'segments[0]: needs turn, radius > 0, angle 90|180, bank (radians)',
    ])
  })

  it('rejects a gate with no segment', () => {
    expect(validate({ ...ok, gates: [{ kind: 'checkpoint' }] })).toContain('gates[0]: segment out of range')
  })

  it('closes a four-curve circle back onto the start pose', () => {
    const seg = { type: 'curve', turn: 'left', radius: 10, angle: 90 } as const
    const all = poses({ ...ok, segments: [seg, seg, seg, seg] })
    const end = all[all.length - 1]
    expect(end.x).toBeCloseTo(0)
    expect(end.z).toBeCloseTo(0)
    expect(end.heading).toBeCloseTo(2 * Math.PI)
  })
})

describe('layoutId', () => {
  it('is stable, ignores the name, and changes with the geometry', () => {
    const a: Track = { name: 'a', start: { x: 0, y: 0, z: 0, heading: 0 }, segments: [{ type: 'straight', length: 40 }], gates: [] }
    expect(layoutId(a)).toMatch(/^[0-9a-f]{8}$/)
    expect(layoutId({ ...a, name: 'b' })).toBe(layoutId(a))
    expect(layoutId({ ...a, segments: [{ type: 'straight', length: 41 }] })).not.toBe(layoutId(a))
  })
})

describe('zones', () => {
  const base: Track = {
    name: 'z',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [{ type: 'straight', length: 100 }, { type: 'curve', turn: 'left', radius: 20, angle: 90 }],
    gates: [{ kind: 'start-finish', segment: 0 }],
  }

  it('validates kind, segment type and range', () => {
    expect(validate({ ...base, zones: [{ kind: 'ice', segment: 0, from: 0.2, to: 0.5 }] })).toEqual([])
    expect(validate({ ...base, zones: [{ kind: 'lava', segment: 0, from: 0, to: 1 }] })).toEqual(['zones[0]: unknown kind'])
    // Surfaces lie on curves too; pads stay on planar segments.
    expect(validate({ ...base, zones: [{ kind: 'ice', segment: 1, from: 0, to: 1 }] })).toEqual([])
    expect(validate({ ...base, zones: [{ kind: 'turbo', segment: 1, from: 0, to: 1 }] })).toHaveLength(1)
    expect(validate({ ...base, zones: [{ kind: 'ice', segment: 5, from: 0, to: 1 }] })).toEqual(['zones[0]: segment out of range'])
    expect(validate({ ...base, zones: [{ kind: 'ice', segment: 0, from: 0.5, to: 0.5 }] })).toHaveLength(1)
  })

  it('layoutId is unchanged without zones and changes with them', () => {
    expect(layoutId({ ...base, zones: [] })).toBe(layoutId(base))
    expect(layoutId({ ...base, zones: [{ kind: 'dirt', segment: 0, from: 0, to: 0.5 }] })).not.toBe(layoutId(base))
  })

  it('zoneCorners spans the zone along the segment, left (+x at heading 0) first', () => {
    const [l0, r0, l1, r1] = zoneCorners(base, { kind: 'dirt', segment: 0, from: 0.2, to: 0.5 }, 8)
    expect([l0.x, l0.z, r0.x, r0.z, l1.z, r1.x]).toEqual([4, 20, -4, 20, 50, -4])
  })
})

describe('barriers', () => {
  const base: Track = {
    name: 'b',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [{ type: 'straight', length: 100 }, { type: 'curve', turn: 'left', radius: 20, angle: 90 }],
    gates: [{ kind: 'start-finish', segment: 0 }],
  }

  it('validates straight and road-following barriers', () => {
    expect(validate({ ...base, barriers: [{ from: [10, 0], to: [10, 20] }, { segment: 1, side: 'left', gap: 2, from: 0.2 }] })).toEqual([])
    expect(validate({ ...base, barriers: [{ from: [10, 0], to: [10, 0] }] })).toEqual(['barriers[0]: from and to must differ'])
    expect(validate({ ...base, barriers: [{ segment: 5, side: 'left' }] })).toEqual(['barriers[0]: segment out of range'])
    expect(validate({ ...base, barriers: [{ segment: 0, side: 'up' }] })).toEqual(['barriers[0]: side must be left or right'])
    expect(validate({ ...base, barriers: [{ segment: 0, side: 'left', gap: -1 }] })).toEqual(['barriers[0]: gap must be >= 0'])
    expect(validate({ ...base, barriers: [{ segment: 0, side: 'left', from: 0.6, to: 0.4 }] })).toEqual(['barriers[0]: needs 0 <= from < to <= 1'])
  })
})
