// Filled bodies under raised road are solid: a car offroad beside a ramp, a drop or a raised
// road hits the body's side walls and end caps like a wall instead of driving inside it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { debugPose } from '../race/debug-pose'
import { bodyBoxes } from '../track/bodies'
import { CAMPAIGN, STYLES, TEST_TRACKS } from '../track/catalogue'
import { resolveTrack } from '../track/kit'
import type { Pillar, Track } from '../track/schema'
import { createCarAt, FixedStepper, NO_INPUT, step, TICK_HZ, trackSurface, v3, type Surface } from '.'

const load = (name: string) =>
  resolveTrack(JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track

// Horizontal distance from (x, z) to a box's footprint, in the box's own frame: 0 inside it.
const gap = (o: Pillar, x: number, z: number): number => {
  const px = x - o.x
  const pz = z - o.z
  const u = px * Math.sin(o.heading) + pz * Math.cos(o.heading)
  const w = px * Math.cos(o.heading) - pz * Math.sin(o.heading)
  return Math.hypot(Math.max(0, Math.abs(u) - o.halfDepth), Math.max(0, Math.abs(w) - o.halfWidth))
}

// A car stopped head-on at a wall has its centre this far out: the body capsule's reach plus radius (car.ts), plus slack.
const REACHED = 2.5

// The car's centre inside a body's footprint and below its road: inside the concrete.
const insideBody = (boxes: readonly Pillar[], p: { x: number; y: number; z: number }): Pillar | undefined =>
  boxes.find((o) => p.y < o.y + o.height && gap(o, p.x, p.z) === 0)

// Open ground at (x, z): nothing but the ground plane under a ray from high above, and no body on it.
const openGround = (surface: Surface, boxes: readonly Pillar[], x: number, z: number): boolean => {
  const hit = surface.raycast(v3(x, 100, z), v3(0, -1, 0), 200)
  return hit !== null && hit.material === 'offroad' && Math.abs(100 - hit.distance) < 1e-6 && boxes.every((o) => gap(o, x, z) > 3)
}

// Drive full throttle for `ticks`; return the tick the car was first inside a body (or -1) and its closest approach to `target`.
const drive = (surface: Surface, boxes: readonly Pillar[], start: ReturnType<typeof createCarAt>, target: Pillar | null, ticks: number) => {
  const sim = new FixedStepper(start, surface)
  let entered = -1
  let closest = Infinity
  for (let i = 0; i < ticks; i++) {
    sim.state = step(sim.state, { ...NO_INPUT, throttle: 1 }, surface)
    const p = sim.state.position
    if (entered < 0 && insideBody(boxes, p)) entered = i
    for (const o of target ? [target] : boxes) closest = Math.min(closest, gap(o, p.x, p.z))
  }
  return { entered, closest, position: sim.state.position }
}

describe('crossover ramp body at the operator offroad pose', () => {
  const track = load('crossover')
  const surface = trackSurface(track)
  const boxes = bodyBoxes(track)

  it('stops the car at the body wall instead of letting it drive inside', () => {
    // The live debug spawn the operator reported: ?track=crossover&x=67.7&y=0.8&z=-87.7&yaw=165.
    const pose = debugPose('?x=67.7&y=0.8&z=-87.7&yaw=165')
    expect(pose).not.toBeNull()
    const run = drive(surface, boxes, createCarAt(pose!), null, 3 * TICK_HZ)
    expect(run.closest, 'the car reaches a body wall').toBeLessThan(REACHED)
    expect(run.entered, `inside a body at tick ${run.entered}, ended at ${JSON.stringify(run.position)}`).toBe(-1)
  })
})

const NAMES = [...new Set(['test1', 'test2', ...CAMPAIGN.map((l) => l.track), ...STYLES.map((l) => l.track), ...TEST_TRACKS])]
// A box this high stands above the car's centre: a real wall, not a step the wheels climb.
const WALL = 1.5
const OUT = 12

describe.each(NAMES)('%s filled bodies', (name) => {
  const track = load(name)
  const surface = trackSurface(track)
  const boxes = bodyBoxes(track)
  // Runs of boxes that touch end to end: one filled body each.
  const runs: Pillar[][] = []
  for (const o of boxes) {
    const last = runs.at(-1)?.at(-1)
    if (last && Math.hypot(o.x - last.x, o.z - last.z) <= o.halfDepth + last.halfDepth + 0.5) runs.at(-1)!.push(o)
    else runs.push([o])
  }

  // Aim a car at `o` from OUT metres along unit (dx, dz) outside it, if that spot is open ground.
  const hit = (o: Pillar, dx: number, dz: number, reach: number) => {
    const x = o.x + dx * (reach + OUT)
    const z = o.z + dz * (reach + OUT)
    if (!openGround(surface, boxes, x, z)) return null
    const heading = Math.atan2(-dx, -dz)
    const car = createCarAt({ x, y: 0, z, heading })
    return drive(surface, boxes, { ...car, velocity: v3(-dx * 30, 0, -dz * 30) }, o, 2 * TICK_HZ)
  }

  const walled = runs.map((run, k) => [k, run] as const).filter(([, run]) => run.some((o) => o.height >= WALL))
  if (walled.length === 0) it('has no filled body as high as a wall', () => expect(boxes.every((o) => o.height < WALL)).toBe(true))
  else it.each(walled)(
    'body %i: a car driven at a side wall and at each end cap never ends up inside',
    (_, run) => {
      const tall = run.reduce((a, b) => (b.height > a.height ? b : a))
      const fx = Math.sin(tall.heading)
      const fz = Math.cos(tall.heading)
      // Side walls: from the left (+x of travel at heading 0) and from the right.
      const sides = [hit(tall, fz, -fx, tall.halfWidth), hit(tall, -fz, fx, tall.halfWidth)].filter((r) => r !== null)
      expect(sides.length, 'at least one side of the body stands on open ground').toBeGreaterThan(0)
      // End caps: the first box from behind, the last from ahead, where the cap is a wall.
      const first = run[0]
      const last = run[run.length - 1]
      const caps = [
        first.height >= WALL ? hit(first, -Math.sin(first.heading), -Math.cos(first.heading), first.halfDepth) : null,
        last.height >= WALL ? hit(last, Math.sin(last.heading), Math.cos(last.heading), last.halfDepth) : null,
      ].filter((r) => r !== null)
      for (const r of [...sides, ...caps]) {
        expect(r.closest, 'the car reaches the wall').toBeLessThan(REACHED)
        expect(r.entered, `inside a body at tick ${r.entered}, ended at ${JSON.stringify(r.position)}`).toBe(-1)
      }
    },
  )
})
