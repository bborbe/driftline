import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDLING, HANDLING_KEYS } from '../physics/handling'
import { devMode, isTuningKey, loadTuning, resetGroup, RunTaint, saveTuning, TUNING_GROUPS, type KeyValueStore } from './tuning'

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

describe('tuning sliders', () => {
  it('cover every handling constant exactly once, grouped Engine, Grip, Steering, Drift, Air', () => {
    expect(TUNING_GROUPS.map((g) => g.title)).toEqual(['Engine', 'Grip', 'Steering', 'Drift', 'Air'])
    const keys = TUNING_GROUPS.flatMap((g) => g.sliders.map((s) => s.key))
    expect([...keys].sort()).toEqual([...HANDLING_KEYS].sort())
  })

  it('every default sits inside its slider range', () => {
    for (const s of TUNING_GROUPS.flatMap((g) => g.sliders)) {
      expect(DEFAULT_HANDLING[s.key]).toBeGreaterThanOrEqual(s.min)
      expect(DEFAULT_HANDLING[s.key]).toBeLessThanOrEqual(s.max)
    }
  })

  it('a group reset restores only that group', () => {
    const drift = TUNING_GROUPS.find((g) => g.title === 'Drift')!
    const tuned = { ...DEFAULT_HANDLING, driftKick: 12, maxSpeed: 50 }
    expect(resetGroup(tuned, drift)).toEqual({ ...DEFAULT_HANDLING, maxSpeed: 50 })
  })
})

describe('tuning persistence', () => {
  it('a stored tune survives a reload; a reset clears the key', () => {
    const mem = memory()
    expect(loadTuning(mem)).toBeNull()
    const tune = { ...DEFAULT_HANDLING, maxSpeed: 55, rearGrip: 2.4 }
    saveTuning(mem, tune)
    expect(loadTuning(mem)).toEqual(tune)
    saveTuning(mem, DEFAULT_HANDLING)
    expect(mem.data.size).toBe(0)
    expect(loadTuning(mem)).toBeNull()
  })

  it('corrupt storage loads nothing', () => {
    const mem = memory()
    mem.setItem('driftline-tuning', '{oops')
    expect(loadTuning(mem)).toBeNull()
  })
})

describe('dev mode', () => {
  it('only ?dev=1 opens it; F2 is the panel key', () => {
    expect(devMode('?dev=1')).toBe(true)
    expect(devMode('?track=test-flat&dev=1')).toBe(true)
    expect(devMode('')).toBe(false)
    expect(devMode('?dev=0')).toBe(false)
    expect(isTuningKey('F2')).toBe(true)
    expect(isTuningKey('KeyH')).toBe(false)
  })
})

describe('RunTaint', () => {
  it('locks a run that was tuned at any tick, even if reset before the line', () => {
    const t = new RunTaint()
    t.runStart(false)
    expect(t.locked).toBe(false)
    t.observe(false)
    t.observe(true)
    t.observe(false)
    expect(t.locked).toBe(true)
    t.runStart(false) // next run on defaults
    expect(t.locked).toBe(false)
    t.runStart(true) // next run starts tuned
    expect(t.locked).toBe(true)
  })
})
