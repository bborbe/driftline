import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { add, createCarAt, FixedStepper, NO_INPUT, rotate, TICK_HZ, trackSurface, v3, wheelTravel, type CarState, type Surface } from '../../physics'
import { resolveTrack } from '../../track/kit'
import { CELL, type Track } from '../../track/schema'
import { drawnTravel, profileHeight, RoadTop } from './ground'
import { PHYSICS_WHEEL_RADIUS } from './rig'

const load = (name: string) =>
  resolveTrack(JSON.parse(readFileSync(new URL(`../../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track

/** The car settled on the grid after 2 s with no input. */
const settled = (track: Track, surface: Surface): CarState => {
  const sim = new FixedStepper(createCarAt(track.start), surface)
  for (let i = 0; i < 2 * TICK_HZ; i++) sim.advance(1 / TICK_HZ, NO_INPUT)
  return sim.state
}

/** World height of each drawn wheel's lowest point. */
const wheelBottoms = (s: CarState, springs: { mount: { x: number; y: number; z: number }; length: number }[]): number[] =>
  springs.map((w) => add(s.position, rotate(s.orientation, v3(w.mount.x, w.mount.y - w.length - PHYSICS_WHEEL_RADIUS, w.mount.z))).y)

describe('profileHeight', () => {
  it('reads the drawn cross-section: asphalt 0.1 m, curbs 0.2 m, grass and beyond 0', () => {
    expect(profileHeight(0, CELL)).toBeCloseTo(0.1, 6)
    expect(profileHeight(3.4, CELL)).toBeCloseTo(0.1, 6)
    expect(profileHeight(-3.8, CELL)).toBeCloseTo(0.2, 6)
    expect(profileHeight(4.5, CELL)).toBe(0)
    expect(profileHeight(30, CELL)).toBe(0)
  })

  it('stretches with the road width', () => {
    expect(profileHeight(3.8, CELL)).toBeCloseTo(0.2, 6)
    expect(profileHeight(3.8, 2 * CELL)).toBeCloseTo(0.1, 6)
  })
})

describe('drawn wheels', () => {
  for (const name of ['test1', 'velodrome']) {
    it(`${name}: a settled car's wheels stand on the drawn asphalt, not the physics surface under it`, () => {
      const track = load(name)
      const surface = trackSurface(track)
      const s = settled(track, surface)
      const physics = wheelTravel(s, surface)
      const ground = track.start.y
      // The bug: on the physics springs the tyres reach the physics surface, 0.1 m inside the drawn road.
      for (const y of wheelBottoms(s, physics)) expect(y - ground).toBeCloseTo(0, 2)
      for (const y of wheelBottoms(s, drawnTravel(physics, s, new RoadTop(track)))) expect(y - ground).toBeCloseTo(0.1, 2)
    })
  }

  it('leaves the springs alone off the road and without a track', () => {
    const track = load('test1')
    const surface = trackSurface(track)
    const s = settled(track, surface)
    const springs = wheelTravel(s, surface)
    expect(drawnTravel(springs, s)).toEqual(springs)
    const far = { ...s, position: v3(s.position.x + 500, s.position.y, s.position.z + 500) }
    expect(drawnTravel(springs, far, new RoadTop(track))).toEqual(springs)
  })

  it('never moves the physics state', () => {
    const track = load('test1')
    const surface = trackSurface(track)
    const s = settled(track, surface)
    const before = JSON.stringify(s)
    drawnTravel(wheelTravel(s, surface), s, new RoadTop(track))
    expect(JSON.stringify(s)).toBe(before)
  })
})
