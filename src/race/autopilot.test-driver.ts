// Pure-pursuit autopilot along a track's centreline, shared by the end-to-end lap tests
// (full-lap.test.ts, conservative `centreline` speeds; the style tracks S01–S05 drive the
// surface-aware `surfaceLine`) and the grass-cut test (cuts.test.ts, the faster `racingLine`,
// surface-aware for the style tracks). The driver itself lives in autopilot.ts (browser-safe, also
// driven by the medal pace ghosts); this file adds the node-only track loader.
import { readFileSync } from 'node:fs'
import { resolveTrack } from '../track/kit'
import type { Track } from '../track/schema'

export * from './autopilot'

export const loadTrack = (name: string) =>
  resolveTrack(JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track
