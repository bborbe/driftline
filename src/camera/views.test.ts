import { describe, expect, it } from 'vitest'
import { loadView, saveView, viewForKey } from './views'
import { cockpitPose, createChase, FAR_RIG, updateChase } from './chase'
import { DT, MAX_SPEED, quatIdentity, v3 } from '../physics'
import { length, sub } from '../physics/vec'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('camera views', () => {
  it('maps 1/2/3 to close/far/cockpit and ignores other keys', () => {
    expect(viewForKey('Digit1')).toBe('close')
    expect(viewForKey('Digit2')).toBe('far')
    expect(viewForKey('Digit3')).toBe('cockpit')
    for (const taken of ['KeyR', 'Backspace', 'KeyL', 'KeyP', 'Escape', 'Enter', 'Space']) expect(viewForKey(taken)).toBeNull()
  })

  it('persists the choice and defaults to close', () => {
    const store = memory()
    expect(loadView(store)).toBe('close')
    saveView(store, 'cockpit')
    expect(loadView(store)).toBe('cockpit')
    store.setItem('driftline.camera', 'garbage')
    expect(loadView(store)).toBe('close')
  })

  it('far chase sits further back than close chase', () => {
    const fwd = v3(0, 0, 1)
    let target = v3()
    let cam = createChase(target, fwd, FAR_RIG)
    for (let t = 0; t < 500; t++) {
      target = v3(0, 0.5, target.z + MAX_SPEED * DT)
      cam = updateChase(cam, target, fwd, MAX_SPEED, DT, FAR_RIG)
    }
    const d = length(sub(cam.position, target))
    expect(d).toBeGreaterThan(8)
    expect(d).toBeLessThanOrEqual(FAR_RIG.maxDistance)
  })

  it('in-car eye sits inside the body and looks forward', () => {
    const p = cockpitPose(v3(0, 1, 0), quatIdentity())
    expect(p.eye.y).toBeGreaterThan(1)
    expect(Math.abs(p.eye.z)).toBeLessThan(1)
    expect(p.look.z).toBeGreaterThan(p.eye.z)
  })
})
