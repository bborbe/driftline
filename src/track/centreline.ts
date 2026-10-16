// Evenly spaced poses along a track's centreline, for debug screenshots (scripts/shots.mjs).
// Pure TypeScript like schema.ts.
import { exitPose, poses, type Pose, type Segment, type Track } from './schema'

/** Centreline length of one segment in metres (arcs by radius × angle, ramps/drops by run). */
export function segmentLength(seg: Segment): number {
  switch (seg.type) {
    case 'straight':
    case 'ramp':
    case 'drop':
    case 'gap':
      return seg.length
    case 'curve':
    case 'banked':
      return (seg.radius * seg.angle * Math.PI) / 180
    case 'hairpin':
      return seg.radius * Math.PI
  }
}

/** Pose `f` (0..1) of the way through a segment. */
export function partialPose(entry: Pose, seg: Segment, f: number): Pose {
  switch (seg.type) {
    case 'straight':
      return exitPose(entry, { ...seg, length: seg.length * f })
    case 'ramp':
      return exitPose(entry, { ...seg, length: seg.length * f, rise: seg.rise * f })
    case 'drop':
      return exitPose(entry, { ...seg, length: seg.length * f, fall: seg.fall * f })
    case 'gap':
      return exitPose(entry, { ...seg, length: seg.length * f, fall: (seg.fall ?? 0) * f })
    case 'curve':
    case 'banked':
      return exitPose(entry, { ...seg, angle: seg.angle * f } as Segment)
    case 'hairpin':
      return exitPose(entry, { type: 'curve', turn: seg.turn, radius: seg.radius, angle: 180 * f } as Segment)
  }
}

/** One pose every `step` metres from the start pose to (excluding) the final exit. */
export function centreline(track: Track, step: number): Pose[] {
  const entries = poses(track)
  const out: Pose[] = []
  let offset = 0 // distance into the current segment of the next sample
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    for (; offset < len; offset += step) out.push(partialPose(entries[i], seg, offset / len))
    offset -= len
  })
  return out
}
