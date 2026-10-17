// test-pad (Track.pad): the whole asphalt square drives as road, and its edge walls stop a car
// driven flat out at them, so the operator can slide anywhere without falling off the line.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validate, type Track } from '../track/schema'
import { createCarAt, NO_INPUT, step, trackSurface, v3 } from '.'

const track = JSON.parse(readFileSync(new URL('../../assets/track/test-pad.json', import.meta.url), 'utf8')) as Track
const pad = track.pad!
const surface = trackSurface(track)

describe('test-pad', () => {
  it('is a valid track with a 400 × 400 m pad', () => {
    expect(validate(track)).toEqual([])
    expect(pad.size).toBe(400)
  })

  it('every point of a 21 × 21 grid over the pad is road at y 0, never offroad', () => {
    const half = pad.size / 2 - 0.5
    let n = 0
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const x = pad.centre[0] - half + (2 * half * i) / 20
        const z = pad.centre[1] - half + (2 * half * j) / 20
        const hit = surface.raycast(v3(x, 5, z), v3(0, -1, 0), 10)
        expect(hit, `${x},${z}`).not.toBeNull()
        expect(hit!.material ?? 'road', `${x},${z}`).toBe('road')
        expect(5 - hit!.distance).toBeCloseTo(0, 6)
        n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(400)
  })

  it('just outside the pad is offroad again, so the pad bounds are the JSON ones', () => {
    const x = pad.centre[0] + pad.size / 2 + 3
    expect(surface.raycast(v3(x, 5, pad.centre[1]), v3(0, -1, 0), 10)?.material).toBe('offroad')
  })

  it.each([
    ['+x', Math.PI / 2, [1, 0]],
    ['-x', -Math.PI / 2, [-1, 0]],
    ['+z', 0, [0, 1]],
    ['-z', Math.PI, [0, -1]],
  ] as const)('a car flat out at 30 m/s toward the %s wall stays inside the pad', (_name, heading, [dx, dz]) => {
    let s = createCarAt({ x: pad.centre[0] + dx * 150, y: 0, z: pad.centre[1] + dz * 150, heading })
    s = { ...s, velocity: v3(dx * 30, 0, dz * 30) }
    const half = pad.size / 2
    for (let i = 0; i < 500; i++) {
      s = step(s, { ...NO_INPUT, throttle: 1 }, surface)
      expect(Math.abs(s.position.x - pad.centre[0])).toBeLessThanOrEqual(half)
      expect(Math.abs(s.position.z - pad.centre[1])).toBeLessThanOrEqual(half)
    }
  })
})
