// Gate pillars are solid: the car hits them like a wall instead of driving through.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gatePillars, type Pillar, type Track } from '../track/schema'
import { createCarAt, FixedStepper, MAX_SPEED, NO_INPUT, step, TICK_HZ, trackSurface, v3 } from '.'

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as Track

// Car centre inside the pillar's footprint (in its own frame).
const inside = (o: Pillar, x: number, z: number): boolean => {
  const px = x - o.x
  const pz = z - o.z
  const u = px * Math.sin(o.heading) + pz * Math.cos(o.heading)
  const w = px * Math.cos(o.heading) - pz * Math.sin(o.heading)
  return Math.abs(u) <= o.halfDepth && Math.abs(w) <= o.halfWidth
}

describe.each(['test1', 'test2'])('%s gate pillars', (name) => {
  const track = load(name)
  const surface = trackSurface(track)
  const pillars = track.gates.flatMap((g) => gatePillars(track, g))

  it('has two pillars per gate', () => {
    expect(pillars).toHaveLength(2 * track.gates.length)
  })

  it.each([30, MAX_SPEED])('a car aimed at each pillar at %s m/s never enters or passes it', (speed) => {
    for (const o of pillars) {
      const fx = Math.sin(o.heading)
      const fz = Math.cos(o.heading)
      const car = createCarAt({ x: o.x - fx * 12, y: o.y, z: o.z - fz * 12, heading: o.heading })
      const sim = new FixedStepper({ ...car, velocity: v3(fx * speed, 0, fz * speed) }, surface)
      for (let i = 0; i < 2 * TICK_HZ; i++) {
        sim.state = step(sim.state, { ...NO_INPUT, throttle: 1 }, surface)
        expect(inside(o, sim.state.position.x, sim.state.position.z)).toBe(false)
      }
      const along = (sim.state.position.x - o.x) * fx + (sim.state.position.z - o.z) * fz
      expect(along).toBeLessThan(0)
    }
  })

  it('the opening between the pillars stays clear', () => {
    for (const gate of track.gates) {
      const [a, b] = gatePillars(track, gate)
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      const fx = Math.sin(a.heading)
      const fz = Math.cos(a.heading)
      const car = createCarAt({ x: mx - fx * 12, y: a.y, z: mz - fz * 12, heading: a.heading })
      const sim = new FixedStepper({ ...car, velocity: v3(fx * 30, 0, fz * 30) }, surface)
      for (let i = 0; i < TICK_HZ; i++) sim.state = step(sim.state, NO_INPUT, surface)
      const along = (sim.state.position.x - mx) * fx + (sim.state.position.z - mz) * fz
      expect(along).toBeGreaterThan(5)
    }
  })
})
