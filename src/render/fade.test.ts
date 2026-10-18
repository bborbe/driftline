import { describe, expect, it } from 'vitest'
import { createFade, FADE_MS, noFade, type FadeTarget } from './fade'

const target = (): FadeTarget => ({ style: { opacity: '', transition: '' } })

describe('createFade', () => {
  it('starts at the initial opacity with no transition', () => {
    const t = target()
    const f = createFade(t, 1)
    expect(f.opacity).toBe(1)
    expect(t.style).toEqual({ opacity: '1', transition: 'none' })
  })
  it('transitions over FADE_MS by default and resolves after waiting that long', async () => {
    const t = target()
    const waited: number[] = []
    const f = createFade(t, 0, async (ms) => void waited.push(ms))
    await f.to(1)
    expect(t.style.opacity).toBe('1')
    expect(t.style.transition).toBe(`opacity ${FADE_MS}ms ease-in-out`)
    expect(waited).toEqual([FADE_MS])
  })
  it('does nothing when already at the target', async () => {
    const waited: number[] = []
    const f = createFade(target(), 0.45, async (ms) => void waited.push(ms))
    await f.to(0.45)
    expect(waited).toEqual([])
  })
  it('jumps without waiting for ms 0', async () => {
    const t = target()
    const waited: number[] = []
    await createFade(t, 1, async (ms) => void waited.push(ms)).to(0, 0)
    expect(t.style).toEqual({ opacity: '0', transition: 'none' })
    expect(waited).toEqual([])
  })
})

describe('noFade', () => {
  it('skips fades for debug spawns, frozen poses and debug cameras', () => {
    expect(noFade('?track=test-ramp&x=1&y=2&z=3&yaw=90&freeze=1')).toBe(true)
    expect(noFade('?track=leap&cam=top')).toBe(true)
  })
  it('fades on the menu and on plain track links', () => {
    expect(noFade('')).toBe(false)
    expect(noFade('?sel=knot')).toBe(false)
    expect(noFade('?track=knot&vol=0')).toBe(false)
  })
})
