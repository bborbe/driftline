import { describe, expect, it } from 'vitest'
import { centreline, partialPose, segmentLength } from './centreline'
import { exitPose, poses, type Track } from './schema'

const track: Track = {
  name: 't',
  start: { x: 0, y: 0, z: 0, heading: 0 },
  segments: [
    { type: 'straight', length: 20 },
    { type: 'curve', turn: 'left', radius: 20, angle: 90 },
    { type: 'ramp', length: 10, rise: 2 },
  ],
  gates: [],
}

describe('centreline', () => {
  it('partial pose at 0 and 1 matches entry and exit', () => {
    for (const seg of track.segments) {
      const entry = { x: 1, y: 2, z: 3, heading: 0.4 }
      expect(partialPose(entry, seg, 0)).toEqual(entry)
      const end = partialPose(entry, seg, 1)
      const exit = exitPose(entry, seg)
      expect(end.x).toBeCloseTo(exit.x)
      expect(end.z).toBeCloseTo(exit.z)
      expect(end.heading).toBeCloseTo(exit.heading)
    }
  })

  it('hairpin half way is a quarter turn', () => {
    const p = partialPose({ x: 0, y: 0, z: 0, heading: 0 }, { type: 'hairpin', turn: 'right', radius: 10 }, 0.5)
    expect(p.heading).toBeCloseTo(-Math.PI / 2)
  })

  it('samples one pose per step over the whole lap', () => {
    const total = track.segments.reduce((s, seg) => s + segmentLength(seg), 0)
    const pts = centreline(track, 5)
    expect(pts).toHaveLength(Math.ceil(total / 5))
    expect(pts[0]).toEqual(track.start)
    expect(pts[4].z).toBeCloseTo(20) // segment boundary lands on the curve entry
    expect(pts[4].heading).toBeCloseTo(poses(track)[1].heading)
  })
})
