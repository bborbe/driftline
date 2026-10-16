// Barriers are walls on the open ground: they stand clear of the road and stop the car.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { barrierPillars, type Track } from '../track/schema'
import { createCarAt, FixedStepper, MAX_SPEED, NO_INPUT, step, TICK_HZ, trackSurface, v3 } from '.'

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as Track

// Clearance (m) between a barrier's footprint and the asphalt.
const CLEARANCE = 0.5

describe.each(['test1', 'test2', 'crossover', 'tower'])('%s barriers', (name) => {
  const track = load(name)
  const surface = trackSurface(track)
  const walls = barrierPillars(track)

  it('every barrier stands on the open ground, clear of the road', () => {
    for (const o of walls) {
      const fx = Math.sin(o.heading)
      const fz = Math.cos(o.heading)
      for (let u = -o.halfDepth; u <= o.halfDepth; u += 0.5) {
        for (const w of [-1, 1]) {
          const lat = w * (o.halfWidth + CLEARANCE)
          const x = o.x + fx * u + fz * lat
          const z = o.z + fz * u - fx * lat
          const hit = surface.raycast(v3(x, 20, z), v3(0, -1, 0), 40)
          expect(hit?.material, `${name} barrier at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe('offroad')
        }
      }
    }
  })

  it.each([30, MAX_SPEED])('a car driven square into each barrier at %s m/s never gets through', (speed) => {
    for (const o of walls) {
      // Across the wall: its local +x (heading + 90°).
      const nx = Math.cos(o.heading)
      const nz = -Math.sin(o.heading)
      for (const side of [-1, 1]) {
        const heading = Math.atan2(-side * nx, -side * nz)
        const car = createCarAt({ x: o.x + side * nx * 12, y: o.y, z: o.z + side * nz * 12, heading })
        const sim = new FixedStepper({ ...car, velocity: v3(-side * nx * speed, 0, -side * nz * speed) }, surface)
        for (let i = 0; i < 2 * TICK_HZ; i++) sim.state = step(sim.state, { ...NO_INPUT, throttle: 1 }, surface)
        const across = side * ((sim.state.position.x - o.x) * nx + (sim.state.position.z - o.z) * nz)
        expect(across).toBeGreaterThan(o.halfWidth)
      }
    }
  })
})
