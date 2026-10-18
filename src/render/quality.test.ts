import { describe, expect, it } from 'vitest'
import {
  AUTO_HIGH_FPS,
  AUTO_MEDIUM_FPS,
  clampKnobs,
  deviceKey,
  effectiveKnobs,
  loadAutoQuality,
  pickQuality,
  PRESETS,
  PROBE_S,
  PROBE_WARMUP_S,
  QualityProbe,
  qualityKnobs,
  saveAutoQuality,
} from './quality'
import { SmokePool, MAX_SMOKE } from './fx/smoke'
import { DustPool, MAX_DUST } from './fx/dust'
import { v3 } from '../physics/vec'
import { createCar, type CarState } from '../physics'

const fake = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('quality presets', () => {
  it('step every knob down from High to Low', () => {
    const [low, medium, high] = PRESETS.map(qualityKnobs)
    expect(high).toEqual({ pixelRatio: 2, shadows: 2048, post: true, reflections: true, aa: false, particles: 1 })
    expect(medium).toEqual({ pixelRatio: 1.5, shadows: 1024, post: true, reflections: true, aa: false, particles: 0.5 })
    expect(low).toEqual({ pixelRatio: 1, shadows: 0, post: false, reflections: false, aa: false, particles: 0.25 })
  })
  it('hands out copies, so editing one never changes the table', () => {
    const k = qualityKnobs('high')
    k.shadows = 0
    expect(qualityKnobs('high').shadows).toBe(2048)
  })
  it('clamps stored knobs to known values, High where unknown', () => {
    expect(clampKnobs(null)).toEqual(qualityKnobs('high'))
    expect(clampKnobs({ pixelRatio: 1.5, shadows: 512, post: false, particles: 3 })).toEqual({ ...qualityKnobs('high'), pixelRatio: 1.5, post: false })
  })
  it('draws a preset with its own knobs, Auto with its pick (High before the probe), Custom with the stored ones', () => {
    const mine = { ...qualityKnobs('low'), shadows: 2048 as const }
    expect(effectiveKnobs('medium', mine, 'low')).toEqual(qualityKnobs('medium'))
    expect(effectiveKnobs('auto', mine, null)).toEqual(qualityKnobs('high'))
    expect(effectiveKnobs('auto', mine, 'low')).toEqual(qualityKnobs('low'))
    expect(effectiveKnobs('custom', mine, 'high')).toEqual(mine)
  })
})

describe('Auto', () => {
  it(`picks High at ≥${AUTO_HIGH_FPS} fps, Medium at ≥${AUTO_MEDIUM_FPS}, else Low`, () => {
    expect(pickQuality(60)).toBe('high')
    expect(pickQuality(55)).toBe('high')
    expect(pickQuality(54.9)).toBe('medium')
    expect(pickQuality(40)).toBe('medium')
    expect(pickQuality(39.9)).toBe('low')
    expect(pickQuality(12)).toBe('low')
  })
  it('skips the warm-up, measures the average fps over the probe, and answers once', () => {
    const run = (fps: number) => {
      const p = new QualityProbe()
      const dt = 1 / fps
      const picks: (string | null)[] = []
      const frames = Math.ceil(((PROBE_WARMUP_S + PROBE_S) * fps) as number) + 30
      for (let i = 0; i < frames; i++) picks.push(p.push(dt))
      return picks.filter((x) => x !== null)
    }
    expect(run(60)).toEqual(['high'])
    expect(run(45)).toEqual(['medium'])
    expect(run(25)).toEqual(['low'])
  })
  it('ignores the stalls of the warm-up: a slow first second does not drag a fast device down', () => {
    const p = new QualityProbe()
    let pick = null
    for (let t = 0; t < PROBE_WARMUP_S; t += 0.25) pick = p.push(0.25) ?? pick // 4 fps while shaders compile
    for (let i = 0; i < 60 * (PROBE_S + 1) && !pick; i++) pick = p.push(1 / 60)
    expect(pick).toBe('high')
  })
  it('keeps the pick per device and forgets it on Re-probe', () => {
    const s = fake()
    const here = deviceKey('UA', 2)
    expect(loadAutoQuality(s, here)).toBeNull()
    saveAutoQuality(s, here, 'medium')
    expect(loadAutoQuality(s, here)).toBe('medium')
    expect(loadAutoQuality(s, deviceKey('UA', 1))).toBeNull() // another screen probes again
    saveAutoQuality(s, here, null)
    expect(loadAutoQuality(s, here)).toBeNull()
    s.setItem('driftline-quality-auto', '{bad')
    expect(loadAutoQuality(s, here)).toBeNull()
  })
})

describe('particle budget', () => {
  // A car sliding at 25 m/s with a 45° slip: full smoke; on grass: full dust.
  const drifting: CarState = { ...createCar(), velocity: v3(25 * Math.sin(Math.PI / 4), 0, 25 * Math.cos(Math.PI / 4)) }
  const live = (scale: number, pool: { scale: number; puffs: unknown[]; update: (dt: number) => void }) => {
    pool.scale = scale
    let peak = 0
    for (let i = 0; i < 300; i++) {
      pool.update(1 / 60)
      peak = Math.max(peak, pool.puffs.length)
    }
    return peak
  }
  it('scales the smoke and dust rate and cap', () => {
    const smoke = (k: number) => {
      const p = new SmokePool()
      return live(k, { get scale() { return p.scale }, set scale(v) { p.scale = v }, puffs: p.puffs, update: (dt) => p.update(drifting, dt) })
    }
    const dust = (k: number) => {
      const p = new DustPool()
      return live(k, { get scale() { return p.scale }, set scale(v) { p.scale = v }, puffs: p.puffs, update: (dt) => p.update(drifting, 'grass', dt) })
    }
    expect(smoke(1)).toBeGreaterThan(smoke(0.5))
    expect(smoke(0.5)).toBeGreaterThan(smoke(0.25))
    expect(smoke(0.25)).toBeLessThanOrEqual(Math.round(MAX_SMOKE * 0.25))
    expect(dust(1)).toBeGreaterThan(dust(0.25))
    expect(dust(0.25)).toBeLessThanOrEqual(Math.round(MAX_DUST * 0.25))
  })
})
