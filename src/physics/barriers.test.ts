// Barriers are walls on the open ground: they stand clear of the road, follow it at a constant
// gap when built along a piece, and stop the car.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BARRIER, barrierPillars, barrierPosts, poses, ROAD_WIDTH, type Track } from '../track/schema'
import { createCarAt, FixedStepper, MAX_SPEED, NO_INPUT, step, TICK_HZ, trackSurface, v3 } from '.'

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as Track

// Clearance (m) between a barrier's footprint and the asphalt.
const CLEARANCE = 0.5

describe.each(['test1', 'test2', 'crossover', 'tower'])('%s barriers', (name) => {
  const track = load(name)
  const surface = trackSurface(track)
  const walls = barrierPillars(track)

  it('every barrier wall and post stands on the open ground, clear of the road', () => {
    for (const o of [...walls, ...barrierPosts(track)]) {
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

describe('road-following barriers', () => {
  const track: Track = {
    name: 't',
    start: { x: 0, y: 0, z: 0, heading: 0 },
    segments: [
      { type: 'straight', length: 40 },
      { type: 'curve', turn: 'right', radius: 30, angle: 90 },
    ],
    gates: [],
    barriers: [
      { segment: 0, side: 'left' },
      { segment: 1, side: 'right', gap: 2, from: 0.25 },
    ],
  }
  const posts = barrierPosts(track)

  it('keep the wall middle a constant distance off the centreline, with a post at every end and joint', () => {
    // Straight: 40 m in 5 m lengths, wall middle 7 + 1.5 + 0.5 m to the left (+x): half the default road, gap, half the wall.
    const straight = posts.slice(0, 9)
    expect(barrierPillars(track).filter((w) => w.halfDepth <= BARRIER.step / 2 + 1e-9)).toHaveLength(barrierPillars(track).length)
    for (const p of straight) expect(p.x).toBeCloseTo(ROAD_WIDTH / 2 + BARRIER.gap + BARRIER.halfWidth, 9)
    expect(straight.map((p) => p.z)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40])
    // Curve: centred 30 m to the right of its entry, wall middle at 30 - (7 + 2 + 0.5) on the inside.
    const entry = poses(track)[1]
    const cx = entry.x - 30
    for (const p of posts.slice(9)) expect(Math.hypot(p.x - cx, p.z - entry.z)).toBeCloseTo(30 - (ROAD_WIDTH / 2 + 2 + BARRIER.halfWidth), 9)
  })
})

