import { describe, expect, it } from 'vitest'
import { LIVE_FX } from '../render/fx/flags'
import { CONTROL_IDS, DEFAULT_TAB, loadTab, moveTab, saveTab, TAB_CONTROLS, TABS } from './tabs'

const fake = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('settings tabs', () => {
  it('puts every control in exactly one tab', () => {
    const placed = TABS.flatMap((t) => TAB_CONTROLS[t])
    expect([...placed].sort()).toEqual([...CONTROL_IDS].sort())
    expect(new Set(placed).size).toBe(placed.length)
  })
  it('groups car, race, graphics and audio as agreed', () => {
    expect(TAB_CONTROLS.car).toEqual(['livery', 'paint', 'number'])
    expect(TAB_CONTROLS.race).toEqual(['time', 'weather', 'laps'])
    expect(TAB_CONTROLS.graphics).toEqual([...LIVE_FX, 'camera', 'reflections'])
    expect(TAB_CONTROLS.audio).toEqual(['volume', 'sfxVolume', 'uiVolume'])
  })
  it('remembers the last tab and falls back on garbage', () => {
    const s = fake()
    expect(loadTab(s)).toBe(DEFAULT_TAB)
    for (const t of TABS) {
      saveTab(s, t)
      expect(loadTab(s)).toBe(t)
    }
    s.setItem('driftline-settings-tab', 'nope')
    expect(loadTab(s)).toBe(DEFAULT_TAB)
  })
  it('cycles with Q and E, wrapping both ways', () => {
    expect(moveTab('car', 'KeyE')).toBe('race')
    expect(moveTab('audio', 'KeyE')).toBe('car')
    expect(moveTab('car', 'KeyQ')).toBe('audio')
    expect(moveTab('race', 'ArrowLeft')).toBe('race')
  })
})
