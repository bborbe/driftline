// Turbo pads and low-grip surfaces: zones on a straight change what the wheels stand on.
import { describe, expect, it } from 'vitest'
import type { Track, Zone, ZoneKind } from '../track/schema'
import { createCarAt, dot, forwardOf, materialUnder, NO_INPUT, quatMul, rotate, step, trackSurface, v3, type CarInput, type CarState } from './index'

const DOWN = v3(0, -1, 0)
const speedOf = (s: CarState) => dot(s.velocity, forwardOf(s))
const straight = (kind?: ZoneKind, from = 0, to = 1): Track => ({
  name: 't',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: [{ type: 'straight', length: 400 }],
  gates: [],
  ...(kind ? { zones: [{ kind, segment: 0, from, to }] } : {}),
})

const run = (track: Track, ticks: number, input: (s: CarState, i: number) => CarInput, start?: CarState): CarState => {
  const surface = trackSurface(track)
  let s = start ?? createCarAt(track.start)
  for (let i = 0; i < ticks; i++) s = step(s, input(s, i), surface)
  return s
}

// Launch to `v` m/s on plain road, then hand the state over moved back to the straight's start.
const launched = (v: number): CarState => {
  const s = run(straight(), 1500, (s) => ({ ...NO_INPUT, throttle: speedOf(s) < v ? 1 : 0, brake: speedOf(s) > v + 0.2 ? 0.3 : 0 }))
  return { ...s, position: v3(s.position.x, s.position.y, 2) }
}

describe('zone materials', () => {
  it('raycast reports the zone kind inside it and omits material on plain road', () => {
    const surf = trackSurface(straight('ice', 0.25, 0.5))
    expect(surf.raycast(v3(0, 2, 150), DOWN, 5)!.material).toBe('ice')
    expect(surf.raycast(v3(0, 2, 50), DOWN, 5)!.material).toBeUndefined()
    expect(surf.raycast(v3(0, 2, 250), DOWN, 5)!.material).toBeUndefined()
  })

  it('materialUnder reads the surface the car stands on', () => {
    const t = straight('dirt', 0, 0.5)
    expect(materialUnder(createCarAt({ x: 0, y: 0, z: 20, heading: 0 }), trackSurface(t))).toBe('dirt')
    expect(materialUnder(createCarAt({ x: 0, y: 0, z: 300, heading: 0 }), trackSurface(t))).toBe('road')
  })
})

describe('turbo pads', () => {
  // Coast over a pad at the start of the straight and compare speed after 1 s with plain road.
  const coastSpeed = (kind?: ZoneKind) => speedOf(run(straight(kind, 0, 0.05), 100, () => NO_INPUT, launched(15)))

  it('yellow pad boosts measurably, red more', () => {
    const road = coastSpeed()
    const yellow = coastSpeed('turbo')
    const red = coastSpeed('turbo-red')
    expect(yellow - road).toBeGreaterThan(3)
    expect(red - yellow).toBeGreaterThan(3)
  })

  // `s` turned by `yaw` about the vertical (motion with it) and moved to (x, z).
  const turned = (s: CarState, yaw: number, x: number, z: number): CarState => {
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
    return { ...s, orientation: quatMul(q, s.orientation), velocity: rotate(q, s.velocity), angularVelocity: rotate(q, s.angularVelocity), position: v3(x, s.position.y, z) }
  }
  // Longest boost seen while coasting `ticks` from `start` over a track with one pad (z 180..220).
  // Throws unless the car's centre actually crossed the pad, so a "no boost" can never mean "never got there".
  const maxTurbo = (pad: Zone, start: CarState, ticks = 500): number => {
    const surface = trackSurface({ ...straight(), zones: [pad] })
    let s = start
    let most = 0
    let onPad = false
    for (let i = 0; i < ticks; i++) {
      s = step(s, NO_INPUT, surface)
      most = Math.max(most, s.turbo)
      if (s.position.z >= 180 && s.position.z <= 220 && Math.abs(s.position.x) < 4) onPad = true
    }
    if (!onPad) throw new Error('car never reached the pad')
    return most
  }
  const mid = (kind: 'turbo' | 'turbo-red', reverse?: boolean): Zone => ({ kind, segment: 0, from: 0.45, to: 0.55, ...(reverse ? { reverse } : {}) })

  it.each(['turbo', 'turbo-red'] as const)('%s boosts along its arrow and never against it', (kind) => {
    const fast = launched(15)
    // Along the arrow (+z) from before the pad, and the wrong way (-z) from past it.
    expect(maxTurbo(mid(kind), turned(fast, 0, 0, 150))).toBeGreaterThan(0)
    expect(maxTurbo(mid(kind), turned(fast, Math.PI, 0, 250))).toBe(0)
    // A reversed pad points -z: the same two runs swap.
    expect(maxTurbo(mid(kind, true), turned(fast, 0, 0, 150))).toBe(0)
    expect(maxTurbo(mid(kind, true), turned(fast, Math.PI, 0, 250))).toBeGreaterThan(0)
  })

  it('crossing within 60° of the arrow boosts, crossing sideways does not', () => {
    const fast = launched(15)
    // 40° off the arrow, from the left of the road, entering the pad at mid-road.
    const a = (40 * Math.PI) / 180
    expect(maxTurbo(mid('turbo'), turned(fast, a, -4.5, 175))).toBeGreaterThan(0)
    // Straight across the road, through the pad.
    expect(maxTurbo(mid('turbo'), turned(fast, Math.PI / 2, -12, 200))).toBe(0)
  })

  it('reversing (rolling backwards) over a pad against its arrow gives no boost', () => {
    // Car points along the arrow but rolls backwards over the pad.
    const fast = launched(15)
    const back = { ...fast, position: v3(0, fast.position.y, 230) }
    const rolling = { ...back, velocity: v3(-back.velocity.x, back.velocity.y, -back.velocity.z) }
    // 2 s: long enough to roll across the whole pad, short of stopping on it.
    expect(maxTurbo(mid('turbo'), rolling, 200)).toBe(0)
  })

  it('the boost runs for a fixed time after leaving the pad, then ends', () => {
    const s = run(straight('turbo', 0, 0.05), 50, () => NO_INPUT, launched(15))
    expect(s.turbo).toBeGreaterThan(0)
    const later = run(straight('turbo', 0, 0.05), 200, () => NO_INPUT, s)
    expect(later.turbo).toBe(0)
  })
})

describe('surface grip', () => {
  // Brake hard from 20 m/s, distance until stopped.
  const stopping = (kind?: ZoneKind) => {
    const start = launched(20)
    const z0 = start.position.z
    const end = run(straight(kind), 1000, (s) => ({ ...NO_INPUT, brake: speedOf(s) > 0.5 ? 1 : 0 }), start)
    return end.position.z - z0
  }
  // Full steer at 20 m/s for 1 s: how far the direction of travel has turned (rad).
  const turned = (kind?: ZoneKind) => {
    const start = launched(20)
    const end = run(straight(kind), 100, () => ({ ...NO_INPUT, steer: 1, throttle: 0.5 }), start)
    return Math.abs(Math.atan2(end.velocity.x, end.velocity.z) - Math.atan2(start.velocity.x, start.velocity.z))
  }

  it('stopping distance grows from road to dirt to grass to ice', () => {
    const road = stopping()
    const dirt = stopping('dirt')
    const grass = stopping('grass')
    const ice = stopping('ice')
    expect(dirt).toBeGreaterThan(road * 1.2)
    expect(ice).toBeGreaterThan(dirt * 2)
    // Grass grips little but also bogs the car down, so it still stops shorter than ice.
    expect(grass).toBeLessThan(ice)
  })

  it('low-grip surfaces turn the car less at the same steering (it slides wide)', () => {
    const road = turned()
    const dirt = turned('dirt')
    const ice = turned('ice')
    expect(dirt).toBeLessThan(road * 0.9)
    expect(ice).toBeLessThan(dirt * 0.6)
  })

  it('ice keeps its acceleration (0→60 km/h within 2× road) while losing side grip', () => {
    // Full throttle from rest on a straight of `kind`: seconds to 60 km/h.
    const to60 = (kind?: ZoneKind) => {
      const surface = trackSurface(straight(kind))
      let s = run(straight(kind), 100, () => NO_INPUT)
      let ticks = 0
      while (speedOf(s) < 60 / 3.6 && ticks < 3000) {
        s = step(s, { ...NO_INPUT, throttle: 1 }, surface)
        ticks++
      }
      return ticks / 100
    }
    expect(to60('ice')).toBeLessThanOrEqual(2 * to60())
    expect(turned('ice')).toBeLessThan(turned() * 0.5)
  })

    it('grass slows a car under full throttle', () => {
    const top = (kind?: ZoneKind) => speedOf(run(straight(kind), 500, () => ({ ...NO_INPUT, throttle: 1 }), launched(15)))
    expect(top('grass')).toBeLessThan(top() - 3)
  })

  it('stays deterministic across zones', () => {
    const t: Track = { ...straight(), zones: [{ kind: 'turbo-red', segment: 0, from: 0.05, to: 0.08 }, { kind: 'ice', segment: 0, from: 0.1, to: 0.3 }] }
    const input = (_: CarState, i: number): CarInput => ({ ...NO_INPUT, throttle: 1, steer: Math.sin(i / 40) })
    expect(run(t, 1000, input)).toEqual(run(t, 1000, input))
    const r: Track = { ...t, zones: [{ ...t.zones![0], reverse: true }, t.zones![1]] }
    expect(run(r, 1000, input)).toEqual(run(r, 1000, input))
  })
})

describe('shipped laps', () => {
  it('lap2 carries turbo pads plus dirt, ice and grass sections, all valid', async () => {
    const { readFileSync } = await import('node:fs')
    const { validate } = await import('../track/schema')
    const lap2 = JSON.parse(readFileSync(new URL('../../assets/track/test2.json', import.meta.url), 'utf8')) as Track
    expect(validate(lap2)).toEqual([])
    expect(new Set(lap2.zones!.map((z) => z.kind))).toEqual(new Set(['turbo', 'turbo-red', 'dirt', 'ice', 'grass']))
  })
})
