import { describe, expect, it, vi } from 'vitest'
import { readGlb } from '../assets/glb'
import { WHEEL_NODES } from '../car/wheels'
import { CARS, DEFAULT_CAR, FALLBACK_CAR, resolveCar } from './cars'

const wheelNames = Object.values(WHEEL_NODES).sort()

describe('car registry', () => {
  for (const car of CARS) {
    it(`${car.id}: loads and resolves the 4 wheel nodes`, async () => {
      if (car.file) {
        // glb entries: read the real file (GLTFLoader needs a browser fetch).
        const names = readGlb(car.file).nodes.map((n) => n.name)
        for (const w of wheelNames) expect(names, w).toContain(w)
      } else {
        const obj = await car.build()
        for (const w of wheelNames) expect(obj.getObjectByName(w), w).toBeDefined()
      }
    })
  }

  it('has unique ids, including the default and the fallback', () => {
    const ids = CARS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_CAR)
    expect(ids).toContain(FALLBACK_CAR)
  })

  it('defaults to race and falls back to box for an unknown id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveCar(undefined).id).toBe('race')
    expect(resolveCar('nope').id).toBe('box')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
