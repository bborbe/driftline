import { describe, expect, it } from 'vitest'
import { MAX_SPEED } from '../physics/car'
import { length, sub, v3 } from '../physics/vec'
import { createChase, CLOSE_RIG } from './chase'
import {
  finishOrbitPosition,
  fovFor,
  fxScale,
  impactOf,
  leanFor,
  LEAN_MAX_DEG,
  loadCameraFx,
  lookAheadFor,
  LOOK_AHEAD_MAX,
  NO_SHAKE,
  saveCameraFx,
  shakeAmp,
  shakeOffset,
  SHAKE_MAX,
  SHAKE_TIME,
  signedSlipDeg,
  SWEEP_DONE,
  sweepPosition,
  sweepProgress,
  updateShake,
} from './feel'

const memStore = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('camera effects setting', () => {
  it('defaults to Full, persists, and ignores junk', () => {
    const s = memStore()
    expect(loadCameraFx(s)).toBe('full')
    saveCameraFx(s, 'off')
    expect(loadCameraFx(s)).toBe('off')
    s.setItem('driftline.camera-fx', 'wild')
    expect(loadCameraFx(s)).toBe('full')
    expect([fxScale('off'), fxScale('low'), fxScale('full')]).toEqual([0, 0.5, 1])
  })
})

describe('speed FOV', () => {
  it('is 70° at rest, 82° at top speed on Full, and constant 70° when Off', () => {
    expect(fovFor(0, 1)).toBe(70)
    expect(fovFor(MAX_SPEED, 1)).toBeCloseTo(82)
    expect(fovFor(MAX_SPEED * 2, 1)).toBeCloseTo(82)
    expect(fovFor(MAX_SPEED, 0.5)).toBeCloseTo(76)
    for (const v of [0, 10, 25, MAX_SPEED]) expect(fovFor(v, 0)).toBe(70)
  })

  it('rises monotonically and stays below the linear ramp at mid speed', () => {
    let last = 0
    for (let v = 0; v <= MAX_SPEED; v += 2) {
      const f = fovFor(v, 1)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
    }
    expect(fovFor(MAX_SPEED / 2, 1)).toBeLessThan(76)
  })
})

describe('drift lean', () => {
  it('reads the signed slip between nose and travel', () => {
    expect(signedSlipDeg(v3(0, 0, 1), v3(0, 0, 20))).toBeCloseTo(0)
    expect(signedSlipDeg(v3(Math.sin(0.5), 0, Math.cos(0.5)), v3(0, 0, 20))).toBeCloseTo(28.65, 1)
    expect(signedSlipDeg(v3(-Math.sin(0.5), 0, Math.cos(0.5)), v3(0, 0, 20))).toBeCloseTo(-28.65, 1)
    expect(signedSlipDeg(v3(1, 0, 0), v3(0, 0, 1))).toBe(0) // too slow to slide
  })

  it('is 0 in grip cornering, at most 4° in a drift, signed, and 0 when Off', () => {
    expect(leanFor(4, 1)).toBe(0)
    expect(leanFor(-5, 1)).toBe(0)
    expect(leanFor(45, 1)).toBe(LEAN_MAX_DEG)
    expect(leanFor(-45, 1)).toBe(-LEAN_MAX_DEG)
    expect(Math.abs(leanFor(18, 1))).toBeGreaterThan(0)
    expect(Math.abs(leanFor(18, 1))).toBeLessThan(LEAN_MAX_DEG)
    expect(leanFor(45, 0)).toBe(0)
  })
})

describe('look-ahead', () => {
  it('leads into the corner, capped at 2 m, and is 0 on a straight or when Off', () => {
    expect(lookAheadFor(0, MAX_SPEED, 1)).toBe(0)
    expect(lookAheadFor(0.5, 20, 1)).toBeCloseTo(0.6)
    expect(lookAheadFor(-0.5, 20, 1)).toBeCloseTo(-0.6)
    expect(lookAheadFor(3, MAX_SPEED, 1)).toBe(LOOK_AHEAD_MAX)
    expect(lookAheadFor(-3, MAX_SPEED, 1)).toBe(-LOOK_AHEAD_MAX)
    expect(lookAheadFor(3, MAX_SPEED, 0)).toBe(0)
  })
})

describe('impact shake', () => {
  const p = v3(0, 1, 0)
  const dt = 1 / 60

  it('fires on a hard landing and a big contact, not on braking, a soft landing or a respawn', () => {
    expect(impactOf(v3(0, -10, 30), v3(0, 0, 30), p, p, dt)).toBeGreaterThan(0)
    expect(impactOf(v3(0, 0, 30), v3(0, 0, 15), p, p, dt)).toBeGreaterThan(0) // wall
    expect(impactOf(v3(0, 0, 30), v3(0, 0, 29.8), p, p, dt)).toBe(0) // hard braking
    expect(impactOf(v3(0, -3, 30), v3(0, 0, 30), p, p, dt)).toBe(0) // kerb hop
    expect(impactOf(v3(0, -10, 30), v3(0, 0, 0), p, v3(40, 1, 0), dt)).toBe(0) // respawn teleport
    expect(impactOf(v3(0, -30, 30), v3(0, 0, 0), p, p, dt)).toBe(1)
  })

  it('is at most 0.15 m, gone within 0.4 s, and 0 when Off', () => {
    let sh = updateShake(NO_SHAKE, 1, 1, dt)
    expect(shakeAmp(sh)).toBeCloseTo(SHAKE_MAX)
    let peak = 0
    for (let t = 0; t < 2; t += dt) peak = Math.max(peak, length(shakeOffset(sh, t)))
    expect(peak).toBeLessThanOrEqual(SHAKE_MAX)
    expect(peak).toBeGreaterThan(SHAKE_MAX * 0.5)
    for (let t = 0; t < SHAKE_TIME + 0.01; t += dt) sh = updateShake(sh, 0, 1, dt)
    expect(shakeAmp(sh)).toBe(0)
    expect(length(shakeOffset(sh, 1))).toBe(0)
    expect(shakeAmp(updateShake(NO_SHAKE, 1, 0, dt))).toBe(0)
  })

  it('a weaker hit does not cut a stronger shake short', () => {
    const big = updateShake(NO_SHAKE, 1, 1, 0.01)
    const after = updateShake(big, 0.35, 1, 0.01)
    expect(after.amp).toBe(big.amp)
  })
})

describe('start sweep', () => {
  const target = v3(0, 0.5, 0)
  const fwd = v3(0, 0, 1)
  const chase = createChase(target, fwd, CLOSE_RIG).position

  it('lands exactly on the chase pose at least 200 ms before GO', () => {
    const total = 3
    expect(SWEEP_DONE).toBeGreaterThanOrEqual(0.2)
    expect(sweepProgress(0.2, total)).toBe(1)
    expect(sweepProgress(SWEEP_DONE, total)).toBe(1)
    expect(sweepPosition(sweepProgress(0.2, total), target, fwd, chase)).toEqual(chase)
  })

  it('starts away from the chase pose, in front of the car, and moves steadily toward it', () => {
    const total = 3
    const start = sweepPosition(sweepProgress(total, total), target, fwd, chase)
    expect(start.z).toBeGreaterThan(target.z) // ahead of the car (the chase cam is behind)
    let last = length(sub(start, chase))
    for (let left = total; left >= 0; left -= 0.1) {
      const d = length(sub(sweepPosition(sweepProgress(left, total), target, fwd, chase), chase))
      expect(d).toBeLessThanOrEqual(last + 1e-9)
      last = d
    }
  })
})

describe('finish orbit', () => {
  it('starts where the chase camera was and circles the car at a steady distance', () => {
    const target = v3(10, 0.5, 10)
    const from = v3(10, 2.5, 5)
    expect(finishOrbitPosition(0, target, from)).toEqual(from)
    const a = finishOrbitPosition(2, target, from)
    const b = finishOrbitPosition(4, target, from)
    expect(Math.hypot(a.x - target.x, a.z - target.z)).toBeCloseTo(6.5)
    expect(Math.hypot(b.x - target.x, b.z - target.z)).toBeCloseTo(6.5)
    expect(length(sub(a, b))).toBeGreaterThan(1) // still moving
  })
})
