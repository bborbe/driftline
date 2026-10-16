// Web Audio graph for the car. Synthesis only — no audio files. Reads car state, never writes it.
import { dot, forwardOf, length, slipAngleDeg, type CarInput, type CarState } from '../physics'
import { engineFreq, masterGain, ONE_SHOTS, skidGain, windGain, type AudioEvent } from './mapping'

// Smoothing time constant for continuous parameters, so per-frame updates never click.
const SMOOTH = 0.05

const noiseBuffer = (ctx: BaseAudioContext): AudioBuffer => {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engineLow: OscillatorNode | null = null
  private engineHigh: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private wind: GainNode | null = null
  private skid: GainNode | null = null
  private muted = false
  private volume = 0.7

  private readonly createContext: () => AudioContext

  constructor(createContext: () => AudioContext = () => new AudioContext()) {
    this.createContext = createContext
  }

  get state(): AudioContextState | 'uninitialized' {
    return this.ctx?.state ?? 'uninitialized'
  }

  get isMuted(): boolean {
    return this.muted
  }

  // Must be called from a user gesture (the Begin click); browsers keep the context suspended otherwise.
  async begin(): Promise<void> {
    if (!this.ctx) this.build(this.createContext())
    if (this.ctx!.state === 'suspended') await this.ctx!.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMaster()
  }

  toggleMute(): void {
    this.setMuted(!this.muted)
  }

  setVolume(volume: number): void {
    this.volume = volume
    this.applyMaster()
  }

  // Called once per rendered frame with the latest simulation state.
  update(state: Readonly<CarState>, input: Readonly<CarInput>): void {
    const ctx = this.ctx
    if (!ctx || !this.engineLow || !this.engineHigh || !this.engineGain || !this.wind || !this.skid) return
    const t = ctx.currentTime
    const forward = dot(state.velocity, forwardOf(state))
    const ground = length({ x: state.velocity.x, y: 0, z: state.velocity.z })
    const f = engineFreq(forward, input.throttle)
    this.engineLow.frequency.setTargetAtTime(f, t, SMOOTH)
    this.engineHigh.frequency.setTargetAtTime(f * 2.01, t, SMOOTH)
    this.engineGain.gain.setTargetAtTime(0.18 + 0.12 * input.throttle, t, SMOOTH)
    this.wind.gain.setTargetAtTime(windGain(ground), t, SMOOTH)
    this.skid.gain.setTargetAtTime(skidGain(slipAngleDeg(state), ground), t, SMOOTH)
  }

  onCheckpoint(): void {
    this.play('checkpoint')
  }

  onFinish(): void {
    this.play('finish')
  }

  onRespawn(): void {
    this.play('respawn')
  }

  private play(event: AudioEvent): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const shot = ONE_SHOTS[event]
    let t = ctx.currentTime
    for (const freq of shot.freqs) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = shot.type
      osc.frequency.setValueAtTime(freq, t)
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(0.3, t + 0.01)
      env.gain.exponentialRampToValueAtTime(0.0001, t + shot.duration)
      osc.connect(env).connect(this.master)
      osc.start(t)
      osc.stop(t + shot.duration + 0.02)
      t += shot.duration
    }
  }

  private applyMaster(): void {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(masterGain(this.muted, this.volume), this.ctx.currentTime, 0.01)
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = masterGain(this.muted, this.volume)
    this.master.connect(ctx.destination)

    // Engine: two detuned sawtooths through a low-pass, so it growls instead of buzzing.
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    const engineFilter = ctx.createBiquadFilter()
    engineFilter.type = 'lowpass'
    engineFilter.frequency.value = 900
    this.engineGain.connect(engineFilter).connect(this.master)
    this.engineLow = ctx.createOscillator()
    this.engineLow.type = 'sawtooth'
    this.engineHigh = ctx.createOscillator()
    this.engineHigh.type = 'sawtooth'
    for (const osc of [this.engineLow, this.engineHigh]) {
      osc.frequency.value = engineFreq(0, 0)
      osc.connect(this.engineGain)
      osc.start()
    }

    // Wind and skid share one looped white-noise source, shaped by different filters.
    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx)
    noise.loop = true
    this.wind = ctx.createGain()
    this.wind.gain.value = 0
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 600
    noise.connect(windFilter).connect(this.wind).connect(this.master)
    this.skid = ctx.createGain()
    this.skid.gain.value = 0
    const skidFilter = ctx.createBiquadFilter()
    skidFilter.type = 'bandpass'
    skidFilter.frequency.value = 2400
    skidFilter.Q.value = 3
    noise.connect(skidFilter).connect(this.skid).connect(this.master)
    noise.start()
  }
}
