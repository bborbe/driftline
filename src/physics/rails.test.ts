// Edge rails are solid: a car steered into one at speed stays on the road, and its speed into the
// rail is gone one tick after it touches — on the ground and up on a ramp alike.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { partialPose, poses, widthAt } from '../track/pose'
import { RAIL } from '../track/rails'
import type { Track } from '../track/schema'
import { createCarAt, NO_INPUT, step, TICK_HZ, trackSurface, v3 } from '.'

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as Track

const SPEED = 20
const ANGLE = (30 * Math.PI) / 180
// A drop in speed towards the rail this large in one tick is the hit (the wall kill in car.ts collide()).
const HIT = 2

describe.each([
  { what: 'a ground straight', name: 'test1', segment: 0, at: 0.4 },
  { what: 'an elevated ramp', name: 'test1', segment: 1, at: 0.6 },
])('a rail beside $what', ({ name, segment, at }) => {
  const track = load(name)
  const surface = trackSurface(track)
  const seg = track.segments[segment]
  const p = partialPose(poses(track)[segment], seg, at)
  const half = widthAt(seg, at) / 2
  // Left of travel, as roadPoint() lays the road out.
  const lx = Math.cos(p.heading)
  const lz = -Math.sin(p.heading)
  const lateral = (x: number, z: number) => (x - p.x) * lx + (z - p.z) * lz

  it.each([1, -1])('stops a car steered at it at 20 m/s and 30° (side %i)', (side) => {
    const heading = p.heading + side * ANGLE
    const start = createCarAt({ x: p.x, y: p.y, z: p.z, heading })
    let state = { ...start, velocity: v3(Math.sin(heading) * SPEED, 0, Math.cos(heading) * SPEED) }
    const into = () => side * (state.velocity.x * lx + state.velocity.z * lz)
    let contact = -1
    let widest = 0
    let before = into()
    for (let tick = 0; tick < 2 * TICK_HZ; tick++) {
      state = step(state, NO_INPUT, surface)
      const u = side * lateral(state.position.x, state.position.z)
      widest = Math.max(widest, u)
      if (contact < 0 && before - into() > HIT) contact = tick
      if (contact >= 0 && tick === contact + 1) expect(into(), `velocity into the rail one tick after contact (tick ${tick})`).toBeLessThanOrEqual(1)
      before = into()
    }
    expect(contact, 'the car reaches the rail').toBeGreaterThanOrEqual(0)
    // It touched the rail, not anything nearer: the body (capsule ±1.2 m long, 0.9 m round) at 30° reaches the face first.
    expect(widest, 'the car centre stops short of the rail face').toBeGreaterThan(half - RAIL.width - 2.5)
    expect(widest, 'the car centre stays on the road').toBeLessThan(half - RAIL.width)
  })
})
