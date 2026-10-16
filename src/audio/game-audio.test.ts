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
class FakeSource extends FakeNode { buffer: unknown = null; loop = false; start() {} }

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
