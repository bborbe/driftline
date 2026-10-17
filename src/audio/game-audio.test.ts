import { describe, expect, it } from 'vitest'
import { createCar, NO_INPUT } from '../physics'
import { GameAudio } from './game-audio'
import { ONE_SHOTS } from './mapping'

// Minimal stand-in for AudioContext: records started oscillators and the master gain's target.
class FakeParam {
  value = 0
  setTargetAtTime(v: number) { this.value = v; return this }
  setValueAtTime(v: number) { this.value = v; return this }
  exponentialRampToValueAtTime() { return this }
}
class FakeNode {
  connect<T>(next: T): T { return next }
}
class FakeGain extends FakeNode { gain = new FakeParam() }
class FakeFilter extends FakeNode { type = ''; frequency = new FakeParam(); Q = new FakeParam() }
class FakeOsc extends FakeNode {
  type = ''
  frequency = new FakeParam()
  private readonly log: FakeOsc[]
  constructor(log: FakeOsc[]) { super(); this.log = log }
  start() { this.log.push(this) }
  stop() {}
}
class FakeSource extends FakeNode { buffer: unknown = null; loop = false; start() {} stop() {} }

class FakeContext {
  state: AudioContextState = 'suspended'
  currentTime = 0
  sampleRate = 8000
  destination = new FakeNode()
  started: FakeOsc[] = []
  gains: FakeGain[] = []
  createGain() { const g = new FakeGain(); this.gains.push(g); return g }
  createBiquadFilter() { return new FakeFilter() }
  createOscillator() { return new FakeOsc(this.started) }
  createBufferSource() { return new FakeSource() }
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) } }
  async resume() { this.state = 'running' }
  async suspend() { this.state = 'suspended' }
}

const setup = () => {
  const ctx = new FakeContext()
  const audio = new GameAudio(() => ctx as unknown as AudioContext)
  return { ctx, audio, master: () => ctx.gains[0] }
}

describe('GameAudio begin gate', () => {
  it('has no running context before begin and runs after', async () => {
    const { ctx, audio } = setup()
    expect(audio.state).toBe('uninitialized')
    await audio.begin()
    expect(ctx.state).toBe('running')
    expect(audio.state).toBe('running')
  })
  it('pause suspends a running context and resume restarts it; no-op before begin', async () => {
    const { ctx, audio } = setup()
    await audio.setPaused(true)
    expect(audio.state).toBe('uninitialized')
    await audio.begin()
    await audio.setPaused(true)
    expect(ctx.state).toBe('suspended')
    await audio.setPaused(false)
    expect(ctx.state).toBe('running')
  })
  it('ignores updates and events before begin', () => {
    const { ctx, audio } = setup()
    audio.update(createCar(), NO_INPUT)
    audio.onCheckpoint()
    expect(ctx.started.length).toBe(0)
  })
})

describe('GameAudio mute and volume', () => {
  it('master gain is 0 when muted and the slider value when unmuted', async () => {
    const { audio, master } = setup()
    await audio.begin()
    audio.setVolume(0.4)
    expect(master().gain.value).toBe(0.4)
    audio.toggleMute()
    expect(audio.isMuted).toBe(true)
    expect(master().gain.value).toBe(0)
    audio.toggleMute()
    expect(master().gain.value).toBe(0.4)
  })
})

describe('GameAudio one-shots', () => {
  it.each([
    ['checkpoint', (a: GameAudio) => a.onCheckpoint()],
    ['finish', (a: GameAudio) => a.onFinish()],
    ['respawn', (a: GameAudio) => a.onRespawn()],
    ['countdown', (a: GameAudio) => a.onCountdown(2)],
    ['go', (a: GameAudio) => a.onCountdown(0)],
    ['newRecord', (a: GameAudio) => a.onNewRecord()],
  ] as const)('%s schedules its own note sequence', async (event, fire) => {
    const { ctx, audio } = setup()
    await audio.begin()
    const before = ctx.started.length
    fire(audio)
    const notes = ctx.started.slice(before)
    expect(notes.map((o) => o.frequency.value)).toEqual([...ONE_SHOTS[event].freqs])
    expect(notes.every((o) => o.type === ONE_SHOTS[event].type)).toBe(true)
  })
})

describe('GameAudio countdown beeps', () => {
  it('3, 2, 1 are the same short low beep and GO is higher and longer', () => {
    expect(ONE_SHOTS.go.freqs[0]).toBeGreaterThan(ONE_SHOTS.countdown.freqs[0])
    expect(ONE_SHOTS.go.duration).toBeGreaterThan(ONE_SHOTS.countdown.duration)
  })
  it('plays through the master gain, so mute silences it', async () => {
    const { audio, master } = setup()
    await audio.begin()
    audio.setMuted(true)
    audio.onCountdown(3)
    expect(master().gain.value).toBe(0)
  })
})

describe('GameAudio finish', () => {
  const throttle = { ...NO_INPUT, throttle: 1 }
  it('silences the engine after the finish and brings it back on restart', async () => {
    const { ctx, audio } = setup()
    await audio.begin()
    const engine = ctx.gains[1]
    audio.update(createCar(), throttle)
    expect(engine.gain.value).toBeGreaterThan(0)
    audio.onFinish()
    audio.update(createCar(), throttle)
    expect(engine.gain.value).toBe(0)
    audio.onRestart()
    audio.update(createCar(), throttle)
    expect(engine.gain.value).toBeGreaterThan(0)
  })
})

// Straight ahead (+z, the car's nose at spawn) at `v` m/s from z: no slip, so no squeal.
const moving = (v: number, z = 0) => ({ ...createCar(), velocity: { x: 0, y: 0, z: v }, position: { x: 0, y: 0.5, z } })

describe('GameAudio buses', () => {
  it('SFX and UI sliders set their own bus gain; 0 silences only that bus', async () => {
    const { ctx, audio, master } = setup()
    await audio.begin()
    const [sfx, ui] = [ctx.gains[2], ctx.gains[3]]
    audio.setVolume(0.5)
    audio.setSfxVolume(0)
    expect(sfx.gain.value).toBe(0)
    expect(ui.gain.value).toBe(1)
    expect(master().gain.value).toBe(0.5)
    audio.setSfxVolume(0.6)
    audio.setUiVolume(0)
    expect(sfx.gain.value).toBe(0.6)
    expect(ui.gain.value).toBe(0)
  })
  it('keeps slider values set before begin', async () => {
    const { ctx, audio } = setup()
    audio.setSfxVolume(0.2)
    audio.setUiVolume(0.3)
    await audio.begin()
    expect([ctx.gains[2].gain.value, ctx.gains[3].gain.value]).toEqual([0.2, 0.3])
  })
})

describe('GameAudio trace', () => {
  it('records one-shots, impacts, squeal and kerb episodes and UI sounds', async () => {
    const { audio } = setup()
    audio.enableTrace()
    await audio.begin()
    audio.onCheckpoint()
    audio.update(moving(20), NO_INPUT)
    audio.update(moving(2, 0.3), NO_INPUT) // 18 m/s lost in one frame: a wall hit
    audio.update(moving(2, 0.3), NO_INPUT, 'road', true)
    audio.update(moving(2, 0.3), NO_INPUT, 'road', true)
    audio.playUi('click', 'tab')
    const kinds = audio.trace!.map((e) => e.kind)
    expect(kinds).toEqual(['checkpoint', 'impact', 'ui'])
    // A slow car on the kerb (2 m/s) is under KERB_MIN_SPEED: no kerb episode. At speed there is one, logged once.
    audio.update(moving(20, 0.6), NO_INPUT, 'road', true)
    audio.update(moving(20, 0.9), NO_INPUT, 'road', true)
    expect(audio.trace!.filter((e) => e.kind === 'kerb')).toHaveLength(1)
  })
  it('a respawn jump is no impact', async () => {
    const { audio } = setup()
    audio.enableTrace()
    await audio.begin()
    audio.update(moving(30), NO_INPUT)
    audio.onRespawn()
    audio.update(moving(0, 50), NO_INPUT)
    expect(audio.trace!.some((e) => e.kind === 'impact')).toBe(false)
  })
  it('a drift squeals on road with a peak level, not on grass', async () => {
    const { audio } = setup()
    audio.enableTrace()
    await audio.begin()
    // Sideways 20 m/s while facing +z: 90° slip.
    const drift = { ...createCar(), velocity: { x: 20, y: 0, z: 0.1 } }
    audio.update(drift, NO_INPUT, 'grass')
    expect(audio.trace!.some((e) => e.kind === 'squeal')).toBe(false)
    audio.update(drift, NO_INPUT, 'road')
    const squeal = audio.trace!.find((e) => e.kind === 'squeal')
    expect(squeal?.level).toBeGreaterThan(0)
  })
  it('records nothing unless enabled', async () => {
    const { audio } = setup()
    await audio.begin()
    audio.onCheckpoint()
    expect(audio.trace).toBeNull()
  })
})

describe('GameAudio UI', () => {
  it('a UI click creates the context (it is a user gesture) and plays its notes', () => {
    const { ctx, audio } = setup()
    audio.playUi('confirm')
    expect(audio.state).not.toBe('uninitialized')
    expect(ctx.started.slice(-2).map((o) => o.frequency.value)).toEqual([990, 1480])
  })
})
