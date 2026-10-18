import { describe, expect, it } from 'vitest'
import {
  createFly,
  flyInputFrom,
  flyQuery,
  flyRequested,
  flyToggleKey,
  FLY_FAST,
  FLY_SPEED,
  isFlyKey,
  look,
  lookDir,
  MAX_PITCH,
  MIN_HEIGHT,
  orbitAngleNear,
  orbitFor,
  orbitPose,
  orbitRequested,
  orbitToggleKey,
  pitchParam,
  startsLook,
  updateFly,
  wrapDeg,
} from './fly'
import { viewForKey } from './views'
import { debugPose } from '../race/debug-pose'
import { centreline } from '../track/centreline'
import { loadLap } from '../track/registry'
import { length, sub, v3 } from '../physics/vec'

const idle = { forward: 0, right: 0, up: 0, fast: false }
const run = (cam: ReturnType<typeof createFly>, input: typeof idle, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) cam = updateFly(cam, input, 1 / 60)
  return cam
}

describe('free-fly camera', () => {
  it('toggles on C, orbits on O, and opens from ?cam=fly / &orbit=1', () => {
    expect(flyToggleKey('KeyC')).toBe(true)
    expect(orbitToggleKey('KeyO')).toBe(true)
    for (const taken of ['KeyR', 'Backspace', 'Delete', 'KeyL', 'KeyP', 'KeyF', 'Escape', 'Enter', 'Space', 'Digit1']) {
      expect(flyToggleKey(taken)).toBe(false)
      expect(orbitToggleKey(taken)).toBe(false)
    }
    expect(viewForKey('KeyC')).toBeNull()
    expect(flyRequested('?track=test1&cam=fly')).toBe(true)
    expect(flyRequested('?cam=top')).toBe(false)
    expect(orbitRequested('?cam=fly&orbit=1')).toBe(true)
    expect(orbitRequested('?cam=fly')).toBe(false)
  })

  it('maps WASD / arrows, Space/E up, Ctrl/Q down and Shift fast', () => {
    expect(flyInputFrom(new Set(['KeyW', 'KeyD', 'KeyE', 'ShiftLeft']))).toEqual({ forward: 1, right: 1, up: 1, fast: true })
    expect(flyInputFrom(new Set(['ArrowDown', 'ArrowLeft', 'KeyQ']))).toEqual({ forward: -1, right: -1, up: -1, fast: false })
    expect(flyInputFrom(new Set(['Space']))).toEqual({ ...idle, up: 1 })
    expect(flyInputFrom(new Set(['ControlLeft']))).toEqual({ ...idle, up: -1 })
    expect(flyInputFrom(new Set(['ControlRight']))).toEqual({ ...idle, up: -1 })
    expect(flyInputFrom(new Set(['Space', 'ControlLeft']))).toEqual(idle)
  })

  it('claims its own keys while flying and leaves the rest', () => {
    for (const k of ['Space', 'ControlLeft', 'ControlRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'ShiftLeft', 'ArrowUp'])
      expect(isFlyKey(k)).toBe(true)
    for (const k of ['KeyC', 'KeyO', 'KeyP', 'Escape', 'Enter', 'Digit1', 'Backquote', 'KeyH']) expect(isFlyKey(k)).toBe(false)
  })

  it('starts a drag-look on the left button and on a macOS Ctrl+click reported as button 2', () => {
    expect(startsLook(0, false)).toBe(true)
    expect(startsLook(0, true)).toBe(true)
    expect(startsLook(2, true)).toBe(true)
    expect(startsLook(2, false)).toBe(false)
    expect(startsLook(1, false)).toBe(false)
  })

  it('accelerates smoothly to the cruise speed and to the fast speed with Shift', () => {
    const start = createFly(v3(0, 10, 0), 0)
    const first = updateFly(start, { ...idle, forward: 1 }, 1 / 60)
    expect(length(first.velocity)).toBeGreaterThan(0)
    expect(length(first.velocity)).toBeLessThan(FLY_SPEED / 2) // eases in, no jump
    expect(length(run(start, { ...idle, forward: 1 }, 2).velocity)).toBeCloseTo(FLY_SPEED, 0)
    expect(length(run(start, { ...idle, forward: 1, fast: true }, 2).velocity)).toBeCloseTo(FLY_FAST, 0)
    // Let go: it glides to a stop.
    expect(length(run(run(start, { ...idle, forward: 1 }, 2), idle, 2).velocity)).toBeLessThan(0.1)
  })

  it('moves along the view: yaw 0 forward is +z, right is -x, E is up', () => {
    const start = createFly(v3(0, 10, 0), 0)
    expect(run(start, { ...idle, forward: 1 }, 1).position.z).toBeGreaterThan(5)
    expect(run(start, { ...idle, right: 1 }, 1).position.x).toBeLessThan(-5)
    expect(run(start, { ...idle, up: 1 }, 1).position.y).toBeGreaterThan(15)
  })

  it('never sinks through the ground plane', () => {
    const diving = createFly(v3(0, 2, 0), 0, -MAX_PITCH)
    const after = run(diving, { ...idle, forward: 1, up: -1, fast: true }, 3)
    expect(after.position.y).toBe(MIN_HEIGHT)
    expect(createFly(v3(0, -5, 0), 0).position.y).toBe(MIN_HEIGHT)
  })

  it('mouse drag right turns right, down looks down, and pitch stops short of straight up/down', () => {
    const cam = createFly(v3(0, 10, 0), 0)
    expect(lookDir(look(cam, 100, 0).yaw, 0).x).toBeLessThan(0) // turned toward -x = screen-right
    expect(look(cam, 0, 100).pitch).toBeLessThan(0)
    expect(look(cam, 0, -1e6).pitch).toBe(MAX_PITCH)
    expect(look(cam, 0, 1e6).pitch).toBe(-MAX_PITCH)
  })

  it('P query reopens the exact view: the spawn parser reads back position and yaw, ?pitch reads back pitch', () => {
    const cam = { ...createFly(v3(-108.04, 23.46, -59.2), (200 * Math.PI) / 180, (-25 * Math.PI) / 180) }
    const q = flyQuery('test2', cam)
    expect(q).toContain('cam=fly')
    expect(q).toContain('track=test2')
    const pose = debugPose(q)!
    expect(pose.x).toBeCloseTo(-108.0, 5)
    expect(pose.y).toBeCloseTo(23.5, 5)
    expect(pose.z).toBeCloseTo(-59.2, 5)
    expect(wrapDeg((pose.heading * 180) / Math.PI)).toBeCloseTo(-160, 5)
    expect((pitchParam(q) * 180) / Math.PI).toBeCloseTo(-25, 5)
    expect(pitchParam('?x=1')).toBe(0)
  })

  for (const name of ['test1', 'test2']) {
    it(`${name}: the orbit circles outside the lap and looks down at its centre`, () => {
      const track = loadLap(name)
      const o = orbitFor(track)
      for (const angle of [0, 1, 2.5, 4]) {
        const pose = orbitPose(o, angle)
        expect(pose.pitch).toBeLessThan(0)
        expect(pose.position.y).toBeGreaterThan(MIN_HEIGHT)
        const flat = (p: { x: number; z: number }) => Math.hypot(p.x - o.centre.x, p.z - o.centre.z)
        for (const p of centreline(track, 4)) expect(flat(p)).toBeLessThan(flat(pose.position))
        // lookDir points at the centre
        const to = sub(o.centre, pose.position)
        const d = lookDir(pose.yaw, pose.pitch)
        expect(d.x * to.x + d.y * to.y + d.z * to.z).toBeCloseTo(length(to), 3)
      }
      // Starting an orbit from a point picks the angle on that side.
      const near = orbitPose(o, orbitAngleNear(o, v3(o.centre.x + 50, 0, o.centre.z)))
      expect(near.position.x).toBeGreaterThan(o.centre.x)
    })
  }
})
