// Built-in flat oval used until the lap1 track (assets) lands.
import type { Track } from '../track/schema'

export const FLAT_OVAL: Track = {
  name: 'flat-oval',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: [
    { type: 'straight', length: 80 },
    { type: 'curve', turn: 'right', radius: 30, angle: 90 },
    { type: 'curve', turn: 'right', radius: 30, angle: 90 },
    { type: 'straight', length: 80 },
    { type: 'curve', turn: 'right', radius: 30, angle: 90 },
    { type: 'curve', turn: 'right', radius: 30, angle: 90 },
  ],
  gates: [
    { kind: 'start-finish', segment: 0 },
    { kind: 'checkpoint', segment: 1 },
    { kind: 'checkpoint', segment: 3 },
    { kind: 'checkpoint', segment: 4 },
  ],
}
