// A bridge's parapets are walls: a car on the deck that drives at the road edge is stopped or
// deflected there and stays on the deck, instead of rolling through the parapet and off the bridge.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { debugPose } from '../race/debug-pose'
import { planBodies, rowCount } from '../track/bodies'
import { CAMPAIGN, STYLES, TEST_TRACKS } from '../track/catalogue'
import { resolveTrack } from '../track/kit'
import { poses, ROAD_WIDTH, sampleSegment, type Track } from '../track/schema'
import { createCarAt, FixedStepper, NO_INPUT, step, TICK_HZ, trackSurface, v3, type Surface } from '.'

const load = (name: string) =>
  resolveTrack(JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track

// Off the deck: nothing drivable within this far under the car's centre (a bridge stands 3 m or more up).
const FALL = 2

// Full throttle for `ticks`; the first tick (after `settle`) the car has no road within FALL below it, or -1.
const drive = (surface: Surface, start: ReturnType<typeof createCarAt>, ticks: number, settle = 0) => {
  const sim = new FixedStepper(start, surface)
  let off = -1
  for (let i = 0; i < ticks; i++) {
    sim.state = step(sim.state, { ...NO_INPUT, throttle: 1 }, surface)
    const p = sim.state.position
    const below = surface.raycast(v3(p.x, p.y + 0.5, p.z), v3(0, -1, 0), 0.5 + FALL)
    if (off < 0 && i >= settle && (below === null || below.material === 'offroad')) off = i
  }
  return { off, position: sim.state.position }
}

describe('crossover bridge at the operator pose', () => {
  const track = load('crossover')
  const surface = trackSurface(track)

  it('keeps a car that starts on the parapet on the deck instead of letting it roll off the bridge', () => {
    // The live debug spawn the operator reported (live ef1e661): the car on the curved bridge's parapet at deck height.
    const pose = debugPose('?x=-90.2&y=8.7&z=35.1&yaw=165')
    expect(pose).not.toBeNull()
    // The pose is on a bridge row of the curve, just past the road edge.
    const plans = planBodies(track)
    const ps = poses(track)
    const near = track.segments.flatMap((seg, i) =>
      plans[i] ? Array.from({ length: rowCount(seg) }, (_, r) => ({ kind: plans[i]!.kinds[r], p: sampleSegment(ps[i], seg, r / (rowCount(seg) - 1)) })) : [],
    ).reduce((a, b) => (Math.hypot(b.p.x - pose!.x, b.p.z - pose!.z) < Math.hypot(a.p.x - pose!.x, a.p.z - pose!.z) ? b : a))
    expect(near.kind).toBe('span')
    expect(Math.hypot(near.p.x - pose!.x, near.p.z - pose!.z)).toBeGreaterThan(ROAD_WIDTH / 2)
    const run = drive(surface, createCarAt(pose!), 3 * TICK_HZ, 10)
    expect(run.off, `off the deck at tick ${run.off}, ended at ${JSON.stringify(run.position)}`).toBe(-1)
  })
})

const NAMES = [...new Set(['test1', 'test2', ...CAMPAIGN.map((l) => l.track), ...STYLES.map((l) => l.track), ...TEST_TRACKS])]
// Off the travel direction toward the edge: a car aimed this far out reaches the parapet in well under a second.
const AIM = (40 * Math.PI) / 180

describe.each(NAMES)('%s bridge parapets', (name) => {
  const track = load(name)
  const surface = trackSurface(track)
  const ps = poses(track)
  // The middle span row of each run of span rows on a straight or curve deck (not a ramp's slope), well clear of its ends.
  const rows = planBodies(track).flatMap((plan, i) => {
    const seg = track.segments[i]
    if (!plan || (seg.type !== 'straight' && seg.type !== 'curve')) return []
    const spans = plan.kinds.map((k, r) => (k === 'span' ? r : -1)).filter((r) => r >= 0)
    if (spans.length < 9) return []
    const r = spans[Math.floor(spans.length / 2)]
    return [{ seg: i, p: sampleSegment(ps[i], seg, r / (plan.kinds.length - 1)) }]
  })
  if (rows.length === 0) it('has no bridge deck to drive into', () => expect(rows).toEqual([]))
  else it.each(rows.map((r) => [r.seg, r] as const))('deck on segment %i: a car aimed at either parapet stays on the bridge', (_, row) => {
    for (const side of [1, -1]) {
      const heading = row.p.heading + side * AIM
      const car = createCarAt({ x: row.p.x, y: row.p.y, z: row.p.z, heading })
      const run = drive(surface, { ...car, velocity: v3(Math.sin(heading) * 20, 0, Math.cos(heading) * 20) }, TICK_HZ)
      expect(run.off, `side ${side}: off the deck at tick ${run.off}, ended at ${JSON.stringify(run.position)}`).toBe(-1)
    }
  })
})
