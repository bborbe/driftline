import { describe, expect, it } from 'vitest'
import { changeSound, clickSound } from './ui-sounds'

const el = (tagName: string, extra: { type?: string; cls?: string } = {}) => ({
  tagName,
  type: extra.type,
  classList: { contains: (c: string) => c === extra.cls },
})

describe('clickSound', () => {
  it('tabs and checkboxes click, buttons confirm, the rest is silent', () => {
    expect(clickSound(el('BUTTON', { cls: 'menu-tab' }))).toBe('click')
    expect(clickSound(el('BUTTON'))).toBe('confirm')
    expect(clickSound(el('INPUT', { type: 'checkbox' }))).toBe('click')
    expect(clickSound(el('INPUT', { type: 'range' }))).toBeNull()
    expect(clickSound(el('DIV'))).toBeNull()
    expect(clickSound(null)).toBeNull()
  })
})

describe('changeSound', () => {
  it('selects and sliders click; checkboxes and text do not (they sounded on click or are typing)', () => {
    expect(changeSound(el('SELECT'))).toBe('click')
    expect(changeSound(el('INPUT', { type: 'range' }))).toBe('click')
    expect(changeSound(el('INPUT', { type: 'checkbox' }))).toBeNull()
    expect(changeSound(el('INPUT', { type: 'number' }))).toBeNull()
  })
})
