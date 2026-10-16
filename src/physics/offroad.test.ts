// Off-track ground: the open ground beside the track grips less, drags, and caps speed, so leaving
// the road always costs time (src/race/cuts.test.ts checks the shipped laps).
import { describe, expect, it } from 'vitest'
import type { Track } from '../track/schema'
import { createCarAt, dot, forwardOf, MATERIALS, materialUnder, NO_INPUT, step, trackSurface, v3, type CarState } from './index'

const DOWN = v3(0, -1, 0)
const THROTTLE = { ...NO_INPUT, throttle: 1 }
const speedOf = (s: CarState) => dot(s.velocity, forwardOf(s))
// A 400 m straight along +z at x = 0; the ground at x = 100 is far from it.
const track: Track = {
  name: 't',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: [{ type: 'straight', length: 400 }],
  gates: [],
}
const surface = trackSurface(track)
const OFF = 100

const drive = (s: CarState, ticks: number): CarState => {
  for (let i = 0; i < ticks; i++) s = step(s, THROTTLE, surface)
  return s
}

describe('off-track ground', () => {
  it('the ground beside the road reads as offroad; the road and banked-turn insides do not', () => {
    expect(surface.raycast(v3(OFF, 2, 50), DOWN, 5)!.material).toBe('offroad')
    expect(surface.raycast(v3(0, 2, 50), DOWN, 5)!.material).toBeUndefined()
    expect(materialUnder(createCarAt({ x: OFF, y: 0, z: 50, heading: 0 }), surface)).toBe('offroad')
    // A banked turn's inner half dips below the ground plane; it is still the road.
    const banked = trackSurface({ ...track, segments: [{ type: 'banked', turn: 'right', radius: 25, angle: 180, bank: 0.26 }] })
    const inner = banked.raycast(v3(-25 + 3, 2, 25), DOWN, 5)!
    expect(inner.material).toBeUndefined()
  })

  it('3 s of full throttle from rest on the grass ends far below the same on the road', () => {
    const road = speedOf(drive(createCarAt({ x: 0, y: 0, z: 0, heading: 0 }), 300))
    const grass = speedOf(drive(createCarAt({ x: OFF, y: 0, z: 0, heading: 0 }), 300))
    expect(road).toBeGreaterThan(15)
    expect(grass).toBeLessThan(0.5 * road)
    expect(grass).toBeLessThanOrEqual(MATERIALS.offroad.maxSpeed! + 0.5)
  })

  it('diving onto the grass at 40 m/s sheds speed to the cap within 2 s', () => {
    let s: CarState = { ...createCarAt({ x: OFF, y: 0, z: 0, heading: 0 }), velocity: v3(0, 0, 40) }
    s = drive(s, 200)
    expect(speedOf(s)).toBeLessThan(MATERIALS.offroad.maxSpeed! + 3)
  })
})
