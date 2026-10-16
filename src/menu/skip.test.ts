import { describe, expect, it } from 'vitest'
import { skipMenu } from './skip'

describe('skipMenu', () => {
  it('shows the menu on a bare URL or render-only params', () => {
    expect(skipMenu('')).toBe(false)
    expect(skipMenu('?renderer=webgl2&fx=bloom')).toBe(false)
  })
  it('skips for track and debug-spawn links', () => {
    expect(skipMenu('?track=lap2')).toBe(true)
    expect(skipMenu('?x=1&y=2&z=3&yaw=0&freeze=1')).toBe(true)
    expect(skipMenu('?cam=top')).toBe(true)
  })
})
