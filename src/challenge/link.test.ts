// Challenge links through the real path: an autopilot lap on a shipped track, recorded by the real GhostRecorder
// (LapLoop → advanceRace → FixedStepper.fed), encoded, decoded and replayed by the real GhostReplayer.
import { describe, expect, it } from 'vitest'
import { FixedStepper, NO_INPUT, TICK_HZ, trackSurface, type CarInput, type CarState } from '../physics'
import { advanceRace, COUNTDOWN_TICKS, LapLoop } from '../race/lap'
import { autopilot, centreline, loadTrack } from '../race/autopilot.test-driver'
import { GhostRecorder, GhostReplayer, type GhostRun } from '../ghost/ghost'
import { layoutId, type Track } from '../track/schema'
import { challengeUrl, encodeChallenge, inputRuns, inputsFromRuns, MAX_CHALLENGE_CHARS, MAX_GHOST_TICKS, packInputs, readChallenge, unpackInputs, type Challenge, type ChallengeContext } from './link'

const TRACK = 'test-checkpoint'
const track = loadTrack(TRACK)

/** The keyboard's input shape (src/input.ts): throttle and brake 0|1, steer -1|0|1. */
const keyboard = (drive: (s: CarState) => CarInput) => (s: CarState): CarInput => {
  const i = drive(s)
  return { ...i, steer: i.steer > 0.15 ? 1 : i.steer < -0.15 ? -1 : 0 }
}

/** One lap driven through the real race path, recorded by the real ghost recorder. */
function recordLap(t: Track, shape: (drive: (s: CarState) => CarInput) => (s: CarState) => CarInput = (d) => d): { run: GhostRun; surface: FixedStepper['surface'] } {
  const loop = new LapLoop(t, () => true)
  const sim = new FixedStepper(loop.spawn(), trackSurface(t))
  const rec = new GhostRecorder()
  loop.on(rec.listener(() => sim.state))
  const drive = shape(autopilot(centreline(t)))
  loop.start(sim.state.tick)
  for (let i = 0; i < COUNTDOWN_TICKS + 60 * TICK_HZ && loop.phase !== 'finished'; i++) {
    advanceRace(loop, sim, 1 / TICK_HZ, loop.phase === 'racing' ? drive(sim.state) : NO_INPUT)
    rec.consume(sim.fed)
  }
  expect(loop.phase).toBe('finished')
  expect(rec.best).not.toBeNull()
  return { run: rec.best!, surface: sim.surface }
}

const replayEnd = (run: GhostRun, surface: FixedStepper['surface']): CarState => {
  const r = new GhostReplayer(run, surface)
  while (!r.done) r.advance()
  return r.state
}

const ctx: ChallengeContext = { track: TRACK, laps: 1, layoutOf: (n) => (n === TRACK ? layoutId(track) : null) }
const challengeOf = (run: GhostRun | null, targetMs = run?.lapTimeMs ?? 12_345): Challenge => ({ track: TRACK, layout: layoutId(track), laps: 1, targetMs, name: 'bo', ghost: run })
const read = (value: string, c: ChallengeContext = ctx) => {
  const r = readChallenge(value, c)
  if (!r.ok) throw new Error(r.reason)
  return r.challenge
}

const keyLap = recordLap(track, keyboard)
const analogLap = recordLap(track)

describe('challenge link round trip', () => {
  it('decodes the keyboard lap exactly and its replay ends bit-identical on the same tick', () => {
    const value = encodeChallenge(challengeOf(keyLap.run))
    const back = read(value)
    expect(back.ghost).toEqual(keyLap.run)
    expect(back.ghost!.inputs.length).toBe(keyLap.run.inputs.length)
    const original = replayEnd(keyLap.run, keyLap.surface)
    const decoded = replayEnd(back.ghost!, keyLap.surface)
    expect(decoded.tick).toBe(keyLap.run.start.tick + keyLap.run.inputs.length)
    expect(decoded).toEqual(original)
    expect(back).toMatchObject({ track: TRACK, laps: 1, targetMs: keyLap.run.lapTimeMs, name: 'BO' })
  })

  it('the replay check discriminates: one dropped or changed input ends elsewhere', () => {
    const original = replayEnd(keyLap.run, keyLap.surface)
    const inputs = keyLap.run.inputs
    const mid = Math.floor(inputs.length / 2)
    const dropped = { ...keyLap.run, inputs: [...inputs.slice(0, mid), ...inputs.slice(mid + 1)] }
    const changed = { ...keyLap.run, inputs: inputs.map((x, i) => (i === mid ? { ...x, steer: x.steer === 1 ? -1 : 1 } : x)) }
    expect(replayEnd(dropped, keyLap.surface)).not.toEqual(original)
    expect(replayEnd(changed, keyLap.surface)).not.toEqual(original)
  })

  it('run-length coding keeps every input field, timeScale and -0 included', () => {
    const inputs: CarInput[] = [
      { throttle: 1, brake: 0, steer: -0, handbrake: false },
      { throttle: 1, brake: 0, steer: -0, handbrake: false },
      { throttle: 0.4, brake: 1, steer: 0.25, handbrake: true, timeScale: 0.5 },
    ]
    const back = inputsFromRuns(inputRuns(inputs))
    expect(back).toEqual(inputs)
    expect(Object.is(back[0].steer, -0)).toBe(true)
    const start = { ...keyLap.run.start, velocity: { x: -0, y: 0, z: 0 } }
    const ghost = read(encodeChallenge(challengeOf({ start, inputs, lapTimeMs: 30 }))).ghost!
    expect(Object.is(ghost.start.velocity.x, -0)).toBe(true)
    expect(ghost.inputs).toEqual(inputs)
  })
})

describe('discrete-input packing', () => {
  it('packs every keyboard state, a slow-motion scale included, and unpacks it exactly', () => {
    const inputs: CarInput[] = []
    for (const throttle of [0, 1]) for (const brake of [0, 1]) for (const steer of [-1, 0, 1]) for (const handbrake of [false, true]) {
      inputs.push({ throttle, brake, steer, handbrake }, { throttle, brake, steer, handbrake }, { throttle, brake, steer, handbrake, timeScale: 0.5 })
    }
    const packed = packInputs(inputs)!
    expect(packed.scale).toBe(0.5)
    expect(unpackInputs(packed.keys, packed.scale, MAX_GHOST_TICKS)).toEqual(inputs)
  })

  it('refuses analog input, -0 steer and two different scales (they take the numeric form)', () => {
    expect(packInputs([{ throttle: 1, brake: 0, steer: 0.3, handbrake: false }])).toBeNull()
    expect(packInputs([{ throttle: 1, brake: 0, steer: -0, handbrake: false }])).toBeNull()
    expect(packInputs([{ throttle: 1, brake: 0, steer: 0, handbrake: false, timeScale: 0.5 }, { throttle: 1, brake: 0, steer: 0, handbrake: false, timeScale: 0.25 }])).toBeNull()
  })

  it('rejects a damaged packing, a zero count and a count past the cap', () => {
    expect(unpackInputs('3A!', undefined, MAX_GHOST_TICKS)).toBeNull()
    expect(unpackInputs('0A', undefined, MAX_GHOST_TICKS)).toBeNull()
    expect(unpackInputs(`${MAX_GHOST_TICKS + 1}A`, undefined, MAX_GHOST_TICKS)).toBeNull()
    expect(unpackInputs('B', undefined, MAX_GHOST_TICKS)).toBeNull() // a scaled symbol with no scale
  })
})

describe('challenge link size limit', () => {
  it('a keyboard lap fits and keeps its ghost payload', () => {
    const value = encodeChallenge(challengeOf(keyLap.run))
    expect(value.length).toBeLessThanOrEqual(MAX_CHALLENGE_CHARS)
    expect(read(value).ghost).not.toBeNull()
  })

  it('an analog-steer lap over the limit falls back to target time only', () => {
    const target = analogLap.run.lapTimeMs
    const value = encodeChallenge(challengeOf(analogLap.run))
    expect(value.length).toBeLessThanOrEqual(MAX_CHALLENGE_CHARS)
    const back = read(value)
    expect(back.ghost).toBeNull()
    expect(back.targetMs).toBe(target)
    // It is over the limit because of its ghost: the same lap as runs alone is larger than the whole cap.
    expect(JSON.stringify(inputRuns(analogLap.run.inputs)).length).toBeGreaterThan(MAX_CHALLENGE_CHARS)
  })

  it('the URL carries track, laps and the challenge', () => {
    const url = new URL(challengeUrl('https://bborbe.github.io/driftline/', challengeOf(keyLap.run)))
    expect(url.searchParams.get('track')).toBe(TRACK)
    expect(url.searchParams.get('laps')).toBe('1')
    expect(read(url.searchParams.get('challenge')!).ghost).toEqual(keyLap.run)
  })
})

describe('malformed challenge links', () => {
  const valid = encodeChallenge(challengeOf(keyLap.run))
  const b64 = (o: unknown) => btoa(typeof o === 'string' ? o : JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const base = { v: 1, t: TRACK, l: layoutId(track), n: 1, ms: 12_345, nm: 'BO' }
  const reason = (value: string, c: ChallengeContext = ctx) => {
    const r = readChallenge(value, c)
    expect(r.ok).toBe(false)
    return r.ok ? '' : r.reason
  }

  it('truncated base64', () => expect(reason(valid.slice(0, Math.floor(valid.length / 2)))).toBe('the link is damaged'))
  it('invalid JSON', () => expect(reason(b64('{nope'))).toBe('the link is damaged'))
  it('not base64 at all', () => expect(reason('%%%')).toBe('the link is damaged'))
  it('a ghost of the wrong shape', () => expect(reason(b64({ ...base, g: { s: [1, 2], r: [], ms: 1 } }))).toBe('the link is damaged'))
  it('a forged run count past the ghost cap', () => expect(reason(b64({ ...base, g: { s: Array(17).fill(0), r: [1e9, 1, 0, 0, 0, 0], ms: 1 } }))).toBe('the link is damaged'))
  it('a forged packed count past the ghost cap', () => expect(reason(b64({ ...base, g: { s: Array(17).fill(0), keys: '999999999A', ms: 1 } }))).toBe('the link is damaged'))
  it('unknown track', () => expect(reason(b64({ ...base, t: 'nowhere' }))).toBe('unknown track "nowhere"'))
  it('another track than the page loads', () => expect(reason(valid, { ...ctx, track: 'test1' })).toBe(`it is for ${TRACK}, not test1`))
  it('a changed layout', () => expect(reason(b64({ ...base, l: '00000000' }))).toBe(`${TRACK} has changed since the link was made`))
  it('another lap count', () => expect(reason(valid, { ...ctx, laps: 3 })).toBe('it is a 1-lap challenge, this race has 3'))
  it('unknown version', () => expect(reason(b64({ ...base, v: 2 }))).toBe('it was made by a different game version'))
})
