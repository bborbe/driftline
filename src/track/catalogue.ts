// Which shipped tracks are campaign levels, style tracks and test tracks, in menu order. Pure and tested.
// Campaign: numbered levels in difficulty tiers, each with medals in its track JSON. Styles: one kit
// track per Trackmania map style (Tech, Fullspeed, Dirt, Ice, LOL). Test: small single-feature
// tracks (≤ 20 s) for checking one mechanic, plus test1/test2 (formerly lap1/lap2).

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

/** Style tracks: one per Trackmania map style, each built only from the kit for that style. */
export const STYLES: readonly CampaignLevel[] = [
  { id: 'S01', track: 'switchback', tier: 'blue' }, // Tech: hairpins and r 10 m kinks, asphalt and dirt
  { id: 'S02', track: 'flatout', tier: 'green' }, // Fullspeed: full throttle all lap, r 80 m banks and drops
  { id: 'S03', track: 'dustbowl', tier: 'blue' }, // Dirt: sweepers to slide through
  { id: 'S04', track: 'glacier', tier: 'red' }, // Ice: a banked ice channel
  { id: 'S05', track: 'washboard', tier: 'white' }, // LOL: a red turbo into five bumps
  { id: 'S06', track: 'looping', tier: 'green' }, // Loop: a turbo into one full vertical loop, then a banked turn and two climbs
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
  'test-loop',
  'test-wallride',
  'test-spiral',
]

/** Old track names that still resolve, so shared `?track=lap1` links keep working. */
export const ALIASES: Readonly<Record<string, string>> = { lap1: 'test1', lap2: 'test2' }

export type GroupId = 'campaign' | 'styles' | 'test'

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

const isStyleTrack = (name: string): boolean => STYLES.some((l) => l.track === name)

const levelEntry = (levels: readonly CampaignLevel[]) => (track: string): MenuEntry => {
  const level = levels.find((l) => l.track === track)
  return level ? { track, label: level.id, tier: level.tier } : { track, label: track }
}

/** Campaign, Styles and Test groups over the shipped track names. Unlisted non-test tracks join the campaign's end. */
export function trackGroups(shipped: string[]): TrackGroup[] {
  const campaign = ordered(
    shipped.filter((n) => !isTestTrack(n) && !isStyleTrack(n)),
    CAMPAIGN.map((l) => l.track),
  ).map(levelEntry(CAMPAIGN))
  const styles = STYLES.filter((l) => shipped.includes(l.track)).map((l) => levelEntry(STYLES)(l.track))
  const test = ordered(shipped.filter(isTestTrack), TEST_TRACKS).map((track): MenuEntry => ({ track, label: track }))
  const groups: TrackGroup[] = [
    { id: 'campaign', title: 'Campaign', entries: campaign },
    { id: 'styles', title: 'Styles', entries: styles },
    { id: 'test', title: 'Test', entries: test },
  ]
  return groups.filter((g) => g.entries.length > 0)
}

/** All shipped tracks in menu order: campaign first, then style tracks, then test tracks. */
export const menuOrder = (shipped: string[]): string[] => trackGroups(shipped).flatMap((g) => g.entries.map((e) => e.track))

/** The track after `name` within its own group, wrapping to the group's first. */
export function nextInGroup(name: string, shipped: string[]): string {
  const group = trackGroups(shipped).find((g) => g.entries.some((e) => e.track === name))
  if (!group) return menuOrder(shipped)[0] ?? name
  const i = group.entries.findIndex((e) => e.track === name)
  return group.entries[(i + 1) % group.entries.length].track
}
