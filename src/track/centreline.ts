// Evenly spaced poses along a track's centreline, for debug screenshots (scripts/shots.mjs).
// Pure TypeScript like schema.ts; the per-segment math is pose.ts.
import { partialPose, poses, segmentLength, widthAt } from './pose'
import type { Pose, Track } from './schema'

export { partialPose, segmentLength } from './pose'

/** One pose every `step` metres from the start pose to (excluding) the final exit, with the road width there. */
export function centreline(track: Track, step: number): (Pose & { width: number })[] {
  const entries = poses(track)
  const out: (Pose & { width: number })[] = []
  let offset = 0 // distance into the current segment of the next sample
  track.segments.forEach((seg, i) => {
    const len = segmentLength(seg)
    for (; offset < len; offset += step) out.push({ ...partialPose(entries[i], seg, offset / len), width: widthAt(seg, offset / len) })
    offset -= len
  })
  return out
}
