import { describe, expect, it } from 'vitest'
import { formatBuildLabel } from './build-info'

describe('formatBuildLabel', () => {
  it('shows short sha, UTC minute and version', () => {
    expect(formatBuildLabel('829af9c1234567890abcdef', '2026-10-16T16:42:07.123Z', '0.0.0')).toBe(
      '829af9c · 2026-10-16 16:42Z · v0.0.0',
    )
  })
})
