// `?fx=bloom,speedlines,skid,smoke` toggles; every effect is off unless named.
export const FX = ['bloom', 'speedlines', 'skid', 'smoke'] as const
export type Fx = (typeof FX)[number]
/** The effects a Settings toggle changes, live; bloom (glow.ts) and skid marks are always on, so `bloom` / `skid` only parse for old links. */
export const LIVE_FX = ['speedlines', 'smoke'] as const satisfies readonly Fx[]

export const parseFx = (search: string): Set<Fx> =>
  new Set(
    (new URLSearchParams(search).get('fx') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is Fx => (FX as readonly string[]).includes(s)),
  )

/** Render passes in order; bloom adds one post pass after the scene pass. */
export const pipelinePasses = (fx: Set<Fx>): string[] => (fx.has('bloom') ? ['scene', 'bloom'] : ['scene'])
