import { describe, expect, it } from 'vitest'
import { choiceLabel } from './settings-panel'

describe('settings panel labels', () => {
  it('names what Track default resolves to when the track is known', () => {
    expect(choiceLabel('default', 'snow')).toBe('Track default (snow)')
    expect(choiceLabel('default')).toBe('Track default')
    expect(choiceLabel('night', 'noon')).toBe('Night')
  })
})
