// Jumps land clean (Trackmania rule, goal SC4): the landing is tangent to the flight arc, so the car
// touches down at most 15° off the surface and keeps its speed — at most 10% lost within 0.5 s.
// Driven through the real lap loop, at the autopilot's jump pace and flat out, the way a human takes it.
import { describe, expect, it } from 'vitest'
import { dot, FixedStepper, length, NO_INPUT, TICK_HZ, trackSurface, v3, wheelContacts, type Surface, type Vec3 } from '../physics'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from './lap'
import { autopilot, centreline, loadTrack, type Sample } from './autopilot.test-driver'
import type { Track } from '../track/schema'

const MAX_OFF_DEG = 15
const MAX_LOSS = 0.1
const AFTER = TICK_HZ / 2 // 0.5 s

type Landing = { airSeconds: number; takeoffSpeed: number; offDeg: number; loss: number; material: string }

// Angle between the velocity and the surface plane at touchdown, in degrees (0 = tangent).
function offSurface(surface: Surface, p: Vec3, vel: Vec3): { offDeg: number; material: string } {
  const hit = surface.raycast(v3(p.x, p.y + 2, p.z), v3(0, -1, 0), 50)
  if (!hit) return { offDeg: 90, material: 'none' }
  return { offDeg: (Math.asin(-dot(vel, hit.normal) / length(vel)) * 180) / Math.PI, material: hit.material ?? 'road' }
}

// One lap; the longest flight and how it landed. Fails on any respawn. The driver holds full
// throttle for the 0.5 s after each touchdown, so the loss is the landing's, not braking for the next turn.
function longestJump(track: Track, samples: Sample[]): Landing {
  const loop = new LapLoop(track, () => true)
  const surface = trackSurface(track)
  const sim = new FixedStepper(loop.spawn(), surface)
  const drive = autopilot(samples)
  let respawns = 0
  loop.on({ respawn: () => respawns++ })
  loop.start(sim.state.tick)
  let air = 0
  let takeoffSpeed = 0
  let best: Landing | null = null
  let open: (Landing & { speed: number; tick: number }) | null = null
  for (let i = 0; i < COUNTDOWN_TICKS + 90 * TICK_HZ && loop.phase !== 'finished'; i++) {
    const input = loop.phase === 'racing' ? drive(sim.state) : NO_INPUT
    advanceRace(loop, sim, 1 / TICK_HZ, open ? { ...input, throttle: 1, brake: 0 } : input)
    const s = sim.state
    if (open && i - open.tick === AFTER) {
      open.loss = (open.speed - length(s.velocity)) / open.speed
      if (!best || open.airSeconds > best.airSeconds) best = open
      open = null
    }
    if (wheelContacts(s, surface) === 0) {
      if (air === 0) takeoffSpeed = length(s.velocity)
      air++
      continue
    }
    if (air > 0.2 * TICK_HZ && !open) {
      open = { airSeconds: air / TICK_HZ, takeoffSpeed, ...offSurface(surface, s.position, s.velocity), loss: 0, speed: length(s.velocity), tick: i }
    }
    air = 0
  }
  expect(loop.phase).toBe('finished')
  expect(respawns).toBe(0)
  expect(best).not.toBeNull()
  return best!
}

// The autopilot's line with its target speed raised to flat out over segments `from`..`to`.
const flatOut = (track: Track, from: number, to: number): Sample[] =>
  centreline(track).map((s, k) => {
    const seg = Math.floor(k / 20)
    return seg >= from && seg <= to ? { ...s, speed: 60 } : s
  })

const firstOf = (track: Track, type: string) => track.segments.findIndex((s) => s.type === type)

const ramp = loadTrack('test-ramp')
const crossover = loadTrack('crossover')
const tower = loadTrack('tower')
const crossGap = firstOf(crossover, 'gap')
// The kit's gap-jump piece (src/track/kit.ts): A05 leap jumps it from a 12 m deck onto a 4 m one.
const leap = loadTrack('leap')
const leapGap = firstOf(leap, 'gap')
const towerDrop = firstOf(tower, 'drop')

const CASES = [
  { name: 'test-ramp at autopilot pace', track: ramp, samples: centreline(ramp), minAir: 0.3, minSpeed: 12 },
  { name: 'test-ramp flat out from the start', track: ramp, samples: flatOut(ramp, 0, firstOf(ramp, 'drop')), minAir: 1, minSpeed: 35 },
  { name: 'crossover gap at autopilot pace', track: crossover, samples: centreline(crossover), minAir: 0.4, minSpeed: 14 },
  { name: 'crossover gap flat out down the long straight', track: crossover, samples: flatOut(crossover, crossGap - 2, crossGap + 1), minAir: 1, minSpeed: 35 },
  // tower's drop is a crest at the end of a long straight: flat out it is a jump too.
  { name: 'tower drop flat out', track: tower, samples: flatOut(tower, towerDrop - 1, towerDrop), minAir: 0.8, minSpeed: 35 },
  { name: 'leap gap-jump at autopilot pace', track: leap, samples: centreline(leap), minAir: 0.5, minSpeed: 14 },
  { name: 'leap gap-jump flat out off the deck', track: leap, samples: flatOut(leap, leapGap - 3, leapGap + 1), minAir: 1, minSpeed: 30 },
]

describe.each(CASES)('jump landing: $name', ({ track, samples, minAir, minSpeed }) => {
  it(`lands on the road ≤ ${MAX_OFF_DEG}° off the surface and loses ≤ ${MAX_LOSS * 100}% speed in 0.5 s`, () => {
    const j = longestJump(track, samples)
    const at = `air ${j.airSeconds.toFixed(2)} s from ${j.takeoffSpeed.toFixed(1)} m/s, ${j.offDeg.toFixed(1)}° off, loss ${(j.loss * 100).toFixed(1)}%`
    expect(j.airSeconds, at).toBeGreaterThan(minAir) // it really jumped
    expect(j.takeoffSpeed, at).toBeGreaterThan(minSpeed) // at the pace this case names
    expect(j.material, at).toBe('road')
    expect(j.offDeg, at).toBeLessThanOrEqual(MAX_OFF_DEG)
    expect(j.loss, at).toBeLessThanOrEqual(MAX_LOSS)
    console.log(`${track.name} landing: ${at}`)
  })
})
