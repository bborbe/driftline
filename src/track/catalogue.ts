// Which shipped tracks are campaign levels and which are test tracks, in menu order. Pure and tested.
// Campaign: numbered levels in difficulty tiers, each with medals in its track JSON. Test: small
// single-feature tracks (≤ 20 s) for checking one mechanic, plus test1/test2 (formerly lap1/lap2).

export type Tier = 'white' | 'green' | 'blue' | 'red' | 'black'

export const TIERS: readonly Tier[] = ['white', 'green', 'blue', 'red', 'black']

export interface CampaignLevel {
  /** Level number shown in the menu, e.g. A01. */
  id: string
  /** Track file name in assets/track/ (without .json). */
  track: string
  tier: Tier
}

/** Campaign order. A level whose track file is not shipped yet is left out of the menu. */
export const CAMPAIGN: readonly CampaignLevel[] = [
  { id: 'A01', track: 'crossover', tier: 'white' },
  { id: 'A02', track: 'tower', tier: 'white' },
  // Built from the piece kit (src/track/kit.ts), in rising difficulty.
  { id: 'A03', track: 'plunge', tier: 'green' },
  { id: 'A04', track: 'knot', tier: 'blue' },
  { id: 'A05', track: 'leap', tier: 'red' },
]

/** Test-track order; any other `test*` track follows these. */
export const TEST_TRACKS: readonly string[] = [
  'test1',
  'test2',
  'test-flat',
  'test-ramp',
  'test-bank',
  'test-surfaces',
  'test-turbo',
  'test-effects',
  'test-checkpoint',
]

/** Old track names that still resolve, so shared `?track=lap1` links keep working. */
export const ALIASES: Readonly<Record<string, string>> = { lap1: 'test1', lap2: 'test2' }

export type GroupId = 'campaign' | 'test'

export interface MenuEntry {
  track: string
  /** Menu label: the level id for campaign levels, the track name otherwise. */
  label: string
  tier?: Tier
}

export interface TrackGroup {
  id: GroupId
  title: string
  entries: MenuEntry[]
}

export const isTestTrack = (name: string): boolean => name.startsWith('test')

/** Canonical name for a requested one: aliases resolve, everything else passes through. */
export const resolveAlias = (name: string): string => ALIASES[name] ?? name

/** The name a track's records were first stored under (test1 → lap1), so renaming keeps them. */
export const recordName = (name: string): string => Object.entries(ALIASES).find(([, to]) => to === name)?.[0] ?? name

const ordered = (names: string[], order: readonly string[]): string[] => [
  ...order.filter((n) => names.includes(n)),
  ...names.filter((n) => !order.includes(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
]

/** Campaign and Test groups over the shipped track names. Unlisted non-test tracks join the campaign's end. */
export function trackGroups(shipped: string[]): TrackGroup[] {
  const campaign = ordered(
    shipped.filter((n) => !isTestTrack(n)),
    CAMPAIGN.map((l) => l.track),
  ).map((track): MenuEntry => {
    const level = CAMPAIGN.find((l) => l.track === track)
    return level ? { track, label: level.id, tier: level.tier } : { track, label: track }
  })
  const test = ordered(shipped.filter(isTestTrack), TEST_TRACKS).map((track): MenuEntry => ({ track, label: track }))
  const groups: TrackGroup[] = [
    { id: 'campaign', title: 'Campaign', entries: campaign },
    { id: 'test', title: 'Test', entries: test },
  ]
  return groups.filter((g) => g.entries.length > 0)
}

/** All shipped tracks in menu order: campaign first, then test tracks. */
export const menuOrder = (shipped: string[]): string[] => trackGroups(shipped).flatMap((g) => g.entries.map((e) => e.track))

/** The track after `name` within its own group, wrapping to the group's first. */
export function nextInGroup(name: string, shipped: string[]): string {
  const group = trackGroups(shipped).find((g) => g.entries.some((e) => e.track === name))
  if (!group) return menuOrder(shipped)[0] ?? name
  const i = group.entries.findIndex((e) => e.track === name)
  return group.entries[(i + 1) % group.entries.length].track
}
