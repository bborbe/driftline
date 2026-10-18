// Settings → Access: the colour-safe HUD palette and the reduced-effects rules live in race.css, so these
// tests read the stylesheet itself; the live check (computed colours on the deployed page) is in the PR.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./race.css', import.meta.url), 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(selector)
  if (at < 0) throw new Error(`no rule for ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}

describe('colour-safe HUD', () => {
  it('uses blue / orange for ahead / behind, not the default blue / red', () => {
    expect(rule('.colour-safe {')).toContain('--delta-ahead: #2f7dff')
    expect(rule('.colour-safe {')).toContain('--delta-behind: #ff9a1f')
    expect(rule('.colour-safe .race-target-delta.race-ahead,')).toContain('background: var(--delta-ahead)')
    expect(rule('.colour-safe .race-target-delta.race-behind,')).toContain('background: var(--delta-behind)')
  })
  it('marks the sign with an arrow, so it does not rest on colour alone', () => {
    expect(rule('.colour-safe .race-target-delta.race-ahead::before')).toContain("content: '▲ '")
    expect(rule('.colour-safe .race-target-delta.race-behind::before')).toContain("content: '▼ '")
  })
  it('letters every medal dot', () => {
    for (const [medal, letter] of [['author', 'A'], ['gold', 'G'], ['silver', 'S'], ['bronze', 'B']])
      expect(rule(`.colour-safe .race-medal-${medal} .race-medal-dot::after`)).toContain(`content: '${letter}'`)
  })
})

describe('reduced effects', () => {
  it('drops the HUD pops but still fades the split away', () => {
    expect(rule('.reduced-effects .race-bump')).toContain('animation: none')
    expect(rule('.reduced-effects .race-split.race-pop')).toContain('race-split-fade')
  })
})
