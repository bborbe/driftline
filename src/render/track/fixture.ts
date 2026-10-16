// Demo track exercising every segment type. Used by tests and as the scene's
// track until the shipped lap file is wired in.
import type { Track } from '../../track/schema'

export const FIXTURE_TRACK: Track = {
  name: 'render-fixture',
  start: { x: 0, y: 0, z: -20, heading: 0 },
  segments: [
    { type: 'straight', length: 60 },
    { type: 'curve', turn: 'right', radius: 30, angle: 90 },
    { type: 'ramp', length: 30, rise: 4 },
    { type: 'straight', length: 10 },
    { type: 'gap', length: 10 },
    { type: 'drop', length: 30, fall: 4 },
    { type: 'banked', turn: 'right', radius: 40, angle: 180, bank: 0.35 },
    { type: 'straight', length: 40 },
    { type: 'hairpin', turn: 'left', radius: 20 },
    { type: 'curve', turn: 'left', radius: 25, angle: 45 },
  ],
  gates: [
    { kind: 'start-finish', segment: 0 },
    { kind: 'checkpoint', segment: 3 },
    { kind: 'checkpoint', segment: 7 },
  ],
}
