// Off-track ground must never pay: for every checkpoint-to-checkpoint leg and every corner on the
// shipped laps, a full-throttle driver cutting straight across the grass is slower than the
// autopilot's fast road line (racingLine) through the same two lines. Runs that never reach the
// line within twice the road time count as slower.
import { describe, expect, it } from 'vitest'
import { FixedStepper, forwardOf, MATERIALS, materialUnder, NO_INPUT, step, TICK_HZ, TRACK_WIDTH, trackSurface, type CarInput, type CarState, type Surface } from '../physics'
import { exitPose, gateLine, poses, type Pose, type Segment, type Track } from '../track/schema'
import { advanceRace, COUNTDOWN_TICKS, crosses, LapLoop } from './lap'
import { autopilot, loadTrack, racingLine, type Sample } from './autopilot.test-driver'
import { STYLES } from '../track/catalogue'

const CORNER = new Set(['curve', 'hairpin', 'banked'])
// Style tracks S01-S05 (src/track/catalogue.ts STYLES).
const STYLE_TRACKS = STYLES.map((l) => l.track)
// Each case drives up to ~15 full-physics runs over a leg; well past vitest's 5 s default under load.
const CUT_TIMEOUT = 30_000
const LOOKAHEAD = 0.5 // s
// A run counts as a grass cut once this share of its ticks is off the road.
const GRASS_SHARE = 0.1
// Aim points across the target line: the cutter may cross it anywhere a gate would count.
const AIM_OFFSETS = [-5, -2.5, 0, 2.5, 5]
// How far before the line the cutter lines up (m): 0 = straight at it.
const APPROACH = [0, 10, 20]

// The autopilot's lap on the fast road line, one state per tick from GO to the finish, no respawn.
function roadRun(track: Track): CarState[] {
  const loop = new LapLoop(track, () => true)
  const surface = trackSurface(track)
  const sim = new FixedStepper(loop.spawn(), surface)
  const drive = autopilot(racingLine(track, STYLE_TRACKS.includes(track.name)), LOOKAHEAD)
  let respawns = 0
  loop.on({ respawn: () => respawns++ })
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS; i++) advanceRace(loop, sim, 1 / TICK_HZ, NO_INPUT)
  const states = [sim.state]
  while (loop.phase !== 'finished' && states.length < 120 * TICK_HZ) {
    advanceRace(loop, sim, 1 / TICK_HZ, drive(sim.state))
    states.push(sim.state)
  }
  expect(loop.phase, `${track.name}: the road line finishes`).toBe('finished')
  expect(respawns).toBe(0)
  const offroad = states.filter((st) => materialUnder(st, surface) === 'offroad').length
  expect(offroad, `${track.name}: the road line stays on the asphalt`).toBeLessThan(0.02 * states.length)
  return states
}

// First tick at or after `from` whose step crosses `pose`'s line.
const crossingTick = (states: CarState[], pose: Pose, from: number): number => {
  for (let i = Math.max(from, 1); i < states.length; i++) if (crosses(pose, states[i - 1].position, states[i].position)) return i
  return -1
}

type Run = { ticks: number; grass: number } // ticks to the target line (Infinity = never), ticks on grass
type Point = { x: number; z: number }

// Full throttle from `start` straight at `approach`, then on through `target` (gates only count
// forwards); stops when the car crosses `target`'s line.
function cut(start: CarState, approach: Point, target: Pose, surface: Surface, limit: number): Run {
  const beyond = { x: target.x + 10 * Math.sin(target.heading), z: target.z + 10 * Math.cos(target.heading) }
  let aim = approach
  let s = start
  let grass = 0
  for (let t = 1; t <= limit; t++) {
    if (Math.hypot(aim.x - s.position.x, aim.z - s.position.z) < 4) aim = beyond
    const f = forwardOf(s)
    const dx = aim.x - s.position.x
    const dz = aim.z - s.position.z
    const angle = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz)
    const input: CarInput = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, 2.5 * angle)), handbrake: false }
    const next = step(s, input, surface)
    if (materialUnder(next, surface) === 'offroad') grass++
    if (crosses(target, s.position, next.position)) return { ticks: t, grass }
    s = next
  }
  return { ticks: Infinity, grass }
}

// The lines to compare between: consecutive gates (start → checkpoints → finish), then each run of
// consecutive corner pieces (split at gates) from its entry to its exit.
function legs(track: Track): { name: string; from: Pose; to: Pose }[] {
  const entries = poses(track)
  const sf = track.gates.find((g) => g.kind === 'start-finish')!
  const gates = [track.start, ...track.gates.filter((g) => g.kind === 'checkpoint').map((g) => gateLine(track, g)), gateLine(track, sf)]
  const out = gates.slice(1).map((to, i) => ({ name: `gate ${i} → ${i + 1}`, from: gates[i], to }))
  // A run stops at a checkpoint: a cut that skips a gate is not a lap at all.
  const gated = (k: number) => track.gates.some((g) => g.segment === k)
  let i = 0
  while (i < track.segments.length) {
    if (!CORNER.has(track.segments[i].type)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < track.segments.length && CORNER.has(track.segments[j + 1].type) && !gated(j + 1)) j++
    out.push({ name: `corner ${i}-${j}`, from: entries[i], to: exitPose(entries[j], track.segments[j]) })
    i = j + 1
  }
  return out
}

describe.each(['test1', 'test2', 'crossover', 'tower', 'plunge', 'knot', 'leap', ...STYLE_TRACKS])('%s grass cuts', (name) => {
  const track = loadTrack(name)
  const surface = trackSurface(track)
  const road = roadRun(track)
  let grassLegs = 0 // legs whose search had at least one run really reach the grass

  it.each(legs(track))('$name: no straight cut across the grass beats the road line', ({ from, to }) => {
    const a = from === track.start ? 0 : crossingTick(road, from, 0)
    expect(a).toBeGreaterThanOrEqual(0)
    const b = crossingTick(road, to, a + 1)
    expect(b).toBeGreaterThan(a)
    const fwd = { x: Math.sin(to.heading), z: Math.cos(to.heading) }
    const across = { x: fwd.z, z: -fwd.x }
    const runs = AIM_OFFSETS.flatMap((o) =>
      APPROACH.map((d) => cut(road[a], { x: to.x + across.x * o - fwd.x * d, z: to.z + across.z * o - fwd.z * d }, to, surface, 2 * (b - a))),
    )
    // A run that stays on the asphalt is a faster road line, not a cut: it raises the bar.
    const onGrass = (r: Run) => r.grass >= GRASS_SHARE * r.ticks
    const roadBest = Math.min(b - a, ...runs.filter((r) => !onGrass(r)).map((r) => r.ticks))
    const cutBest = Math.min(...runs.filter(onGrass).map((r) => r.ticks))
    if (runs.some(onGrass)) grassLegs++
    expect(cutBest, `best grass cut ${cutBest} ticks vs road ${roadBest}`).toBeGreaterThan(roadBest)
  }, CUT_TIMEOUT)
  // Math.min over no grass runs is Infinity, which passes every leg: the search as a whole must
  // reach the grass, unless walls line every corner so no run can (a walled channel, e.g. glacier).
  it('the search really reaches the grass, or walls line every corner', () => {
    const walled = track.segments.every((seg, k) => !CORNER.has(seg.type) || (track.barriers ?? []).some((b) => 'segment' in b && b.segment === k && 'turn' in seg && b.side === seg.turn))
    expect(grassLegs > 0 || walled, `${name}: ${grassLegs} of ${legs(track).length} legs reached the grass`).toBe(true)
  })
})

// A skilled grass line through one corner piece: brake on the road, then a tighter arc across the
// grass inside the corner (concentric with it), at the speed the grass grips, and back out
// through the exit line. Straight cuts never try this; a hairpin's inside is where a driver would.
const GRASS_LATERAL = 7 // m/s², what the grass holds in a steady turn
const INSIDE = [1, 2.5, 4, 6, 8] // m inside the road's inner edge

type Corner = Extract<Segment, { type: 'curve' | 'hairpin' | 'banked' }>
const sweep = (seg: Corner) => (seg.type === 'hairpin' ? Math.PI : (seg.angle * Math.PI) / 180)

function insideLine(entry: Pose, seg: Corner, radius: number): Sample[] {
  const s = seg.turn === 'left' ? 1 : -1
  const cx = entry.x + Math.cos(entry.heading) * seg.radius * s
  const cz = entry.z - Math.sin(entry.heading) * seg.radius * s
  const v = Math.min(MATERIALS.offroad.maxSpeed!, Math.sqrt(GRASS_LATERAL * radius))
  const out: Sample[] = []
  for (let k = 0; k <= 20; k++) {
    const th = (sweep(seg) * k) / 20
    const a = entry.heading + s * th
    out.push({ pose: { x: cx - s * radius * Math.cos(a), y: entry.y, z: cz + s * radius * Math.sin(a), heading: a }, speed: v })
  }
  const exit = exitPose(entry, seg)
  for (let d = 0; d <= 40; d += 4) {
    out.push({ pose: { ...exit, x: exit.x + d * Math.sin(exit.heading), z: exit.z + d * Math.cos(exit.heading) }, speed: v })
  }
  return out
}

// Ticks for `drive` from `start` until it crosses `target`, with ticks on grass.
function follow(start: CarState, samples: Sample[], target: Pose, surface: Surface, limit: number): Run {
  const drive = autopilot(samples, LOOKAHEAD)
  let s = start
  let grass = 0
  for (let t = 1; t <= limit; t++) {
    const next = step(s, drive(s), surface)
    if (materialUnder(next, surface) === 'offroad') grass++
    if (crosses(target, s.position, next.position)) return { ticks: t, grass }
    s = next
  }
  return { ticks: Infinity, grass }
}

describe.each(['test1', 'test2', 'crossover', 'tower', 'plunge', 'knot', 'leap', ...STYLE_TRACKS])('%s skilled grass lines', (name) => {
  const track = loadTrack(name)
  const surface = trackSurface(track)
  const road = roadRun(track)
  const entries = poses(track)
  const corners = track.segments.flatMap((seg, i) => (CORNER.has(seg.type) ? [{ i, seg: seg as Corner }] : []))

  it.each(corners)('corner $i: no tighter arc across the grass inside it beats the road line', ({ i, seg }) => {
    const from = entries[i]
    const to = exitPose(from, seg)
    const a = crossingTick(road, from, 0)
    expect(a).toBeGreaterThanOrEqual(0)
    const b = crossingTick(road, to, a + 1)
    expect(b).toBeGreaterThan(a)
    const inner = seg.radius - TRACK_WIDTH / 2
    const runs = INSIDE.filter((d) => inner - d > 2).map((d) => ({
      inside: d,
      ...follow(road[a], insideLine(from, seg, inner - d), to, surface, 2 * (b - a)),
    }))
    // Beside a corner with an inner wall the inside line rides the wall on the road: there a run
    // counts as a cut by its off-road share (as the straight cuts above), and a run that stays on
    // the road raises the bar instead. Every other corner keeps the plain rule: no inside run wins.
    const innerWall = (track.barriers ?? []).some((bar) => 'segment' in bar && bar.segment === i && bar.side === seg.turn)
    const isCut = (r: Run) => !innerWall || r.grass >= GRASS_SHARE * Math.min(r.ticks, 2 * (b - a))
    const roadBest = Math.min(b - a, ...runs.filter((r) => !isCut(r)).map((r) => r.ticks))
    const best = runs.filter(isCut).reduce((m, r) => (r.ticks < m.ticks ? r : m), { inside: 0, ticks: Infinity, grass: 0 })
    expect(best.ticks, `${name} corner ${i}: ${best.inside} m inside took ${best.ticks} ticks vs road ${roadBest}`).toBeGreaterThan(roadBest)
  }, CUT_TIMEOUT)
})

// Skilled lines found by hand on the live game: leave the road after gate `from`, drive the
// waypoints across the grass, then rejoin the fast road line to gate `to`. Each one stays here as a
// regression case once a wall closes it.
const SKILLED: Record<string, { name: string; from: number; to: number; waypoints: [number, number][] }[]> = {
  test2: [
    // Operator 2026-10-16: past gate 5, swing left across the infield onto seg 21, skipping hairpin 20.
    ...[-60, -50, -40].map((z) => ({
      name: `gate 5 → 6 across the hairpin-20 infield at z ${z}`,
      from: 5,
      to: 6,
      waypoints: [[-80, -64], [-86, z + 4], [-95, z], [-104, z - 3], [-110, z - 8]] as [number, number][],
    })),
    // The same cut around the north end of the infield wall, through the inside of hairpin 20.
    ...[-32, -26, -22].map((z) => ({
      name: `gate 5 → 6 round the infield wall at z ${z}`,
      from: 5,
      to: 6,
      waypoints: [[-80, -60], [-80, -46], [-83, z - 2], [-95, z], [-107, z - 2], [-110, -46]] as [number, number][],
    })),
  ],
}

describe.each(Object.keys(SKILLED))('%s skilled lines', (name) => {
  const track = loadTrack(name)
  const surface = trackSurface(track)
  const road = roadRun(track)
  const line = racingLine(track)
  const sf = track.gates.find((g) => g.kind === 'start-finish')!
  const gates = [track.start, ...track.gates.filter((g) => g.kind === 'checkpoint').map((g) => gateLine(track, g)), gateLine(track, sf)]

  it.each(SKILLED[name])('$name is slower than the road line', ({ from, to, waypoints }) => {
    const a = from === 0 ? 0 : crossingTick(road, gates[from], 0)
    const b = crossingTick(road, gates[to], a + 1)
    expect(b).toBeGreaterThan(a)
    const [lx, lz] = waypoints[waypoints.length - 1]
    const rejoin = line.reduce((m, p, k) => (Math.hypot(p.pose.x - lx, p.pose.z - lz) < Math.hypot(line[m].pose.x - lx, line[m].pose.z - lz) ? k : m), 0)
    const rest = [...line.slice(rejoin), ...line.slice(0, rejoin)].slice(0, 200)
    // One sample every ~2 m, like the road line: the autopilot aims a few samples ahead.
    const dense = waypoints.flatMap(([x, z], k) => {
      if (k === 0) return [[x, z]]
      const [px, pz] = waypoints[k - 1]
      const n = Math.max(1, Math.round(Math.hypot(x - px, z - pz) / 2))
      return Array.from({ length: n }, (_, j) => [px + ((x - px) * (j + 1)) / n, pz + ((z - pz) * (j + 1)) / n])
    })
    const runs = [8, 10, 14].map((v) =>
      follow(road[a], [...dense.map(([x, z]) => ({ pose: { x, y: 0, z, heading: 0 }, speed: v })), ...rest], gates[to], surface, 2 * (b - a)),
    )
    const best = Math.min(...runs.map((r) => r.ticks))
    expect(best, `best ${best} ticks vs road ${b - a}`).toBeGreaterThan(b - a)
  }, CUT_TIMEOUT)
})

// Multi-level tracks add one cut class flat tracks lack: dropping off a deck onto the ground below
// and driving straight at the next gate. From every point where the road line is up on a deck,
// leave it to either side at full throttle and head for the next gate. A run that lands on the
// ground (GRASS_SHARE of its ticks off-road) is a drop; one that stays on the road is a faster road
// line and only raises the bar, as in the straight-cut test above. No drop may beat that bar.
const DECK_HEIGHT = 4 // m: road-line states above this count as on a deck
const DROP_STEP = 40 // ticks between drop-off points along the road line
const DROP_OUT = [6, 12, 20] // m sideways from the car where the run aims first

// cut() with a sideways first aim point; counts the ticks spent on the ground.
function dropRun(start: CarState, approach: Point, target: Pose, surface: Surface, limit: number): Run {
  const beyond = { x: target.x + 10 * Math.sin(target.heading), z: target.z + 10 * Math.cos(target.heading) }
  let aim = approach
  let s = start
  let grass = 0
  for (let t = 1; t <= limit; t++) {
    if (Math.hypot(aim.x - s.position.x, aim.z - s.position.z) < 4) aim = beyond
    const f = forwardOf(s)
    const angle = Math.atan2(f.x * (aim.z - s.position.z) - f.z * (aim.x - s.position.x), f.x * (aim.x - s.position.x) + f.z * (aim.z - s.position.z))
    const next = step(s, { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, 2.5 * angle)), handbrake: false }, surface)
    if (materialUnder(next, surface) === 'offroad') grass++
    if (crosses(target, s.position, next.position)) return { ticks: t, grass }
    s = next
  }
  return { ticks: Infinity, grass }
}

describe.each(['crossover', 'tower', 'plunge', 'knot', 'leap', 'flatout'])('%s deck drop-offs', (name) => {
  const track = loadTrack(name)
  const surface = trackSurface(track)
  const road = roadRun(track)
  const sf = track.gates.find((g) => g.kind === 'start-finish')!
  const gates = [...track.gates.filter((g) => g.kind === 'checkpoint').map((g) => gateLine(track, g)), gateLine(track, sf)]
  // Tick at which the road line crosses each gate, in lap order.
  const at: number[] = []
  for (const g of gates) at.push(crossingTick(road, g, (at[at.length - 1] ?? 0) + 1))
  const points = road.flatMap((st, k) => (k % DROP_STEP === 0 && st.position.y > DECK_HEIGHT ? [k] : []))
  let drops = 0 // runs that really left the deck, summed over the points below

  it('the road line spends time up on a deck', () => {
    expect(at.every((t) => t > 0)).toBe(true)
    expect(points.length).toBeGreaterThan(5)
  })

  it.each(points)('dropping off the deck at tick %i never beats the road to the next gate', (k) => {
    const next = at.findIndex((t) => t > k)
    const f = forwardOf(road[k])
    const flat = Math.hypot(f.x, f.z)
    const runs = DROP_OUT.flatMap((out) =>
      [-1, 1].map((side) => {
        const approach = { x: road[k].position.x + (side * out * f.z) / flat, z: road[k].position.z - (side * out * f.x) / flat }
        return { out: side * out, ...dropRun(road[k], approach, gates[next], surface, 2 * (at[next] - k)) }
      }),
    )
    const fell = (r: Run) => r.grass >= GRASS_SHARE * Math.min(r.ticks, 2 * (at[next] - k))
    drops += runs.filter(fell).length
    const roadBest = Math.min(at[next] - k, ...runs.filter((r) => !fell(r)).map((r) => r.ticks))
    const drop = runs.filter(fell).reduce((m, r) => (r.ticks < m.ticks ? r : m), { out: 0, ticks: Infinity, grass: 0 })
    expect(drop.ticks, `${name} tick ${k}: drop ${drop.out} m reached gate ${next + 1} in ${drop.ticks} vs road ${roadBest}`).toBeGreaterThan(roadBest)
  })
  // Runs right before a gate cross its line before they land; the search as a whole must not be vacuous.
  it('the search really drops off the deck', () => {
    expect(drops).toBeGreaterThan(points.length)
  })
})
