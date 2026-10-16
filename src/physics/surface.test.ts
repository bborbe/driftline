import { describe, expect, it } from 'vitest'
import type { Track } from '../track/schema'
import {
  createCar, dot, FLAT, forwardOf, NO_INPUT, rotate, step, trackSurface, v3, wheelContacts,
  type CarInput, type CarState, type Surface,
} from './index'

const speedOf = (s: CarState) => dot(s.velocity, forwardOf(s))
const DOWN = v3(0, -1, 0)
const at = (track: Track) => trackSurface(track)
const track = (segments: Track['segments']): Track => ({ name: 't', start: { x: 0, y: 0, z: 0, heading: 0 }, segments, gates: [] })

describe('surface raycast', () => {
  it('flat plane hits y = 0 straight down', () => {
    expect(FLAT.raycast(v3(3, 2, -4), DOWN, 5)).toEqual({ distance: 2, normal: v3(0, 1, 0) })
    expect(FLAT.raycast(v3(0, 2, 0), DOWN, 1)).toBeNull()
  })

  it('ramp rises linearly with a tilted normal', () => {
    const surf = at(track([{ type: 'ramp', length: 20, rise: 4 }]))
    const hit = surf.raycast(v3(0, 10, 10), DOWN, 20)!
    expect(hit.distance).toBeCloseTo(8, 9) // y = 2 halfway up
    expect(hit.normal.z).toBeCloseTo(-0.2 / Math.hypot(0.2, 1), 9)
  })

  it('banked turn raises the outer edge by tan(bank) per metre', () => {
    // Right turn from heading 0: centre at (-R, 0); outward at the entry is +x.
    // No ground plane: the inner edge dips below y = 0.
    const surf = trackSurface(track([{ type: 'banked', turn: 'right', radius: 30, angle: 90, bank: Math.PI / 6 }]), { groundY: null })
    const outer = surf.raycast(v3(3, 10, 0.5), DOWN, 20)!
    const inner = surf.raycast(v3(-3, 10, 0.5), DOWN, 20)!
    expect(10 - outer.distance).toBeCloseTo(3 * Math.tan(Math.PI / 6), 2)
    expect(10 - inner.distance).toBeCloseTo(-3 * Math.tan(Math.PI / 6), 2)
  })

  it('misses off the track edge when there is no ground plane', () => {
    const surf = trackSurface(track([{ type: 'straight', length: 20 }]), { groundY: null })
    expect(surf.raycast(v3(8, 1, 5), DOWN, 5)).toBeNull()
  })
})

// Straight run-up, ramp off the end, flat ground (y = 0) beyond it.
const RAMP = at(track([{ type: 'straight', length: 120 }, { type: 'ramp', length: 20, rise: 3 }]))
const rampInput = (s: CarState): CarInput => ({ ...NO_INPUT, throttle: speedOf(s) < 25 ? 1 : 0 })
const runRamp = (ticks: number) => {
  let s = createCar(v3(0, 0.7, 5))
  const states: CarState[] = []
  for (let t = 0; t < ticks; t++) states.push((s = step(s, rampInput(s), RAMP)))
  return states
}

describe('ramp jump', () => {
  it('leaves the ground, lands upright on 4 wheels and keeps its speed', () => {
    const states = runRamp(1200)
    const air = states.map((s) => wheelContacts(s, RAMP) === 0)
    const takeoff = air.indexOf(true)
    expect(takeoff).toBeGreaterThan(0)
    const touchdown = air.indexOf(false, takeoff)
    expect(touchdown - takeoff).toBeGreaterThanOrEqual(30) // ≥ 0.3 s airborne
    const allDown = states.findIndex((s, i) => i >= touchdown && wheelContacts(s, RAMP) === 4)
    expect(allDown - touchdown).toBeLessThanOrEqual(100) // all 4 wheels within 1 s
    for (const s of states.slice(touchdown)) expect(rotate(s.orientation, v3(0, 1, 0)).y).toBeGreaterThan(0.9)
    expect(speedOf(states[touchdown])).toBeGreaterThanOrEqual(0.7 * speedOf(states[takeoff - 1]))
  })

  it('is deterministic over 1000 ticks of the ramp run', () => {
    const a = runRamp(1000).at(-1)!
    const b = runRamp(1000).at(-1)!
    expect(a.tick).toBe(1000)
    expect(a.position).toEqual(b.position)
    expect(a.velocity).toEqual(b.velocity)
    expect(a.orientation).toEqual(b.orientation)
  })
})

// 150 m run-up, 180° right turn of radius 30 m, exit straight; no ground plane, so sliding off is a fall.
const R = 30
const bankedTrack = (bank: number): Surface =>
  trackSurface(track([
    { type: 'straight', length: 150 },
    { type: 'banked', turn: 'right', radius: R, angle: 180, bank },
    { type: 'straight', length: 100 },
  ]), { groundY: null })

// Drives the turn at 25 m/s with a deterministic centreline-following steer controller.
const driveTurn = (surface: Surface) => {
  const cx = -R
  const cz = 150
  let s = createCar(v3(0, 0.7, 5))
  let maxOffset = 0
  let ticks = 0
  let full = 0
  let minContacts = 4
  let entered = false
  for (let t = 0; t < 3000 && s.position.y > -5; t++) {
    const rx = s.position.x - cx
    const rz = s.position.z - cz
    if (entered && rz < 0) break // 180° done
    let steer = -0.5 * s.position.x // hold the run-up centreline
    if (rz > 0) {
      entered = true
      const r = Math.hypot(rx, rz)
      let tx = rz / r
      let tz = -rx / r
      if (tx * s.velocity.x + tz * s.velocity.z < 0) [tx, tz] = [-tx, -tz]
      const f = forwardOf(s)
      steer = Math.max(-1, Math.min(1, 0.3 * (r - R) + 3 * (tx * -f.z + tz * f.x)))
      const c = wheelContacts(s, surface)
      maxOffset = Math.max(maxOffset, Math.abs(r - R))
      minContacts = Math.min(minContacts, c)
      if (c === 4) full++
      ticks++
    }
    s = step(s, { ...NO_INPUT, steer, throttle: speedOf(s) < 25 ? 1 : 0 }, surface)
  }
  return { maxOffset, minContacts, fullContact: full / ticks, fell: s.position.y <= -5 }
}

describe('banked turn', () => {
  it('holds a 30° banked 180° turn at 25 m/s', () => {
    const r = driveTurn(bankedTrack(Math.PI / 6))
    expect(r.fell).toBe(false)
    expect(r.maxOffset).toBeLessThan(1.5)
    expect(r.minContacts).toBeGreaterThanOrEqual(2)
    expect(r.fullContact).toBeGreaterThanOrEqual(0.9)
  })

  it('the same turn unbanked slides off at that speed', () => {
    const r = driveTurn(bankedTrack(0))
    expect(r.maxOffset).toBeGreaterThan(5)
  })
})
