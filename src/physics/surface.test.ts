import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { poses, type Track } from '../track/schema'
import {
  createCar, createCarAt, dot, FLAT, forwardOf, NO_INPUT, rotate, step, trackSurface, v3, wheelContacts,
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

  it('banked turn raises the outer edge by tan(bank) per metre about the centreline', () => {
    // Right turn from heading 0: centre at (-R, 0); outward is +x. Mid-turn (45° of 90°)
    // the bank is fully in, so heights follow (r - R) · tan(bank).
    const R = 30
    const surf = trackSurface(track([{ type: 'banked', turn: 'right', radius: R, angle: 90, bank: Math.PI / 6 }]), { groundY: null })
    const at = (r: number) => {
      const a = Math.PI / 4
      return 10 - surf.raycast(v3(-R + r * Math.cos(a), 10, r * Math.sin(a)), DOWN, 20)!.distance
    }
    expect(at(R + 3)).toBeCloseTo(3 * Math.tan(Math.PI / 6), 2)
    expect(at(R - 3)).toBeCloseTo(-3 * Math.tan(Math.PI / 6), 2)
  })

  it('banked turn joints are flat and continuous with the segments either side', () => {
    const surf = trackSurface(
      track([{ type: 'straight', length: 10 }, { type: 'banked', turn: 'right', radius: 30, angle: 90, bank: 0.26 }, { type: 'straight', length: 10 }]),
      { groundY: null },
    )
    for (const x of [-4.9, -2, 0, 2, 4.9]) {
      // Just before and just after the entry joint (z = 10), across the whole road width.
      const before = 10 - surf.raycast(v3(x, 10, 9.99), DOWN, 20)!.distance
      const after = 10 - surf.raycast(v3(x, 10, 10.01), DOWN, 20)!.distance
      expect(Math.abs(after - before), `x ${x}`).toBeLessThan(0.01)
    }
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
    // 2.5 m, not 1.5: the bank now eases in and out over 30% of the turn at each end
    // (src/track/bank.ts) so both joints are flat — the fix for the operator-visible step at
    // the joints. Less bank near the ends widens the line on this synthetic 30°/25 m/s turn.
    // A deliberate trade, not a loosened bar: the real lap1 turn keeps 1.5 m (test below).
    expect(r.maxOffset).toBeLessThan(2.5)
    expect(r.minContacts).toBeGreaterThanOrEqual(2)
    expect(r.fullContact).toBeGreaterThanOrEqual(0.9)
  })

  it('drives lap1\'s banked turn (segment 5) at race speed: ≤ 1.5 m off line, 4 wheels down, no step', () => {
    const lap = JSON.parse(readFileSync('assets/track/test1.json', 'utf8')) as Track
    const surface = trackSurface(lap)
    const seg = lap.segments[5] as Extract<Track['segments'][number], { type: 'banked' }>
    const entry = poses(lap)[5] // (-30, -30), heading π; right turn, centre (-15, -30)
    const cx = entry.x - Math.cos(entry.heading) * seg.radius
    const cz = entry.z + Math.sin(entry.heading) * seg.radius
    let s = createCarAt({ ...entry, z: entry.z + 70 }) // 70 m run-up on straight 4
    let maxOffset = 0
    let minContacts = 4
    let maxClimb = 0
    let prevY = s.position.y
    let entered = false
    for (let t = 0; t < 3000; t++) {
      const rx = s.position.x - cx
      const rz = s.position.z - cz
      if (entered && rx > 0) break // 90° done: past the exit at (-15, -45)
      let steer = -0.5 * (s.position.x - entry.x) // hold the run-up centreline (heading -z)
      if (rz < 0) {
        entered = true
        const r = Math.hypot(rx, rz)
        let tx = rz / r
        let tz = -rx / r
        if (tx * s.velocity.x + tz * s.velocity.z < 0) [tx, tz] = [-tx, -tz]
        const f = forwardOf(s)
        steer = Math.max(-1, Math.min(1, 0.3 * (r - seg.radius) + 3 * (tx * -f.z + tz * f.x)))
        maxOffset = Math.max(maxOffset, Math.abs(r - seg.radius))
        minContacts = Math.min(minContacts, wheelContacts(s, surface))
      }
      maxClimb = Math.max(maxClimb, Math.abs(s.position.y - prevY))
      prevY = s.position.y
      s = step(s, { ...NO_INPUT, steer, throttle: speedOf(s) < 14 ? 1 : 0 }, surface)
    }
    expect(entered).toBe(true)
    expect(maxOffset).toBeLessThanOrEqual(1.5)
    expect(minContacts).toBe(4)
    expect(maxClimb).toBeLessThan(0.05) // per 10 ms tick: no step at either joint
  })

  it('the same turn unbanked slides off at that speed', () => {
    const r = driveTurn(bankedTrack(0))
    expect(r.maxOffset).toBeGreaterThan(5)
  })
})
