import { describe, expect, it } from 'vitest'
import { exitPose, layoutId, poses, validate, type Pose, type Track } from './schema'

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

  it('rejects an unknown segment type', () => {
    expect(validate({ ...ok, segments: [{ type: 'loop' }] })).toContain('segments[0]: unknown segment type loop')
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
