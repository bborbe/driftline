// Web Audio graph for the car. Synthesis only — no audio files. Reads car state, never writes it.
import { dot, forwardOf, length, slipAngleDeg, type CarInput, type CarState, type Material } from '../physics'
import {
  busGain, engineFreq, impactGain, IMPACT_FLOOR, kerbFreq, kerbGain, masterGain, ONE_SHOTS, rumbleGain, skidGain, squealFreq, squealGain,
  squeals, SURFACE_SOUND, turboGain, UI_SHOTS, windGain, type AudioEvent, type UiSound,
} from './mapping'

// Smoothing time constant for continuous parameters, so per-frame updates never click.
const SMOOTH = 0.05
// Finish fade time constant: ~0.5 s (three constants) to silence.
const FADE = 0.15
// Shortest gap (s) between two impact thumps, so one scrape along a wall is not a machine gun.
const IMPACT_GAP = 0.15
// A frame-to-frame jump longer than this (m) is a respawn or a debug teleport, not a crash.
const TELEPORT = 5
// The new-record sting waits for the finish fanfare (4 × 0.16 s) to end.
const RECORD_DELAY = 0.7

/** One entry of the `?audiolog=1` trace: a one-shot, or the start of a squeal / kerb episode with its peak level. */
export type AudioTraceEvent = { t: number; kind: AudioEvent | 'squeal' | 'kerb' | 'impact' | 'ui'; level?: number; detail?: string }

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
  private skidFilter: BiquadFilterNode | null = null
  private rumble: GainNode | null = null
  private rumbleFilter: BiquadFilterNode | null = null
  private turbo: GainNode | null = null
  private sfx: GainNode | null = null
  private ui: GainNode | null = null
  private squeal: GainNode | null = null
  private squealOsc: OscillatorNode | null = null
  private kerb: GainNode | null = null
  private kerbOsc: OscillatorNode | null = null
  private noise: AudioBuffer | null = null
  private muted = false
  private sfxVolume = 1
  private uiVolume = 1
  // Last frame's velocity and position, for the impact check; null until the first update after a (re)start.
  private lastVel: { x: number; y: number; z: number } | null = null
  private lastPos: { x: number; y: number; z: number } | null = null
  private lastImpact = -Infinity
  private squealing: AudioTraceEvent | null = null
  private kerbing: AudioTraceEvent | null = null
  /** The `?audiolog=1` event trace (enableTrace); null when off, so a normal run records nothing. */
  trace: AudioTraceEvent[] | null = null
  // Set by onFinish: the run is over, so engine and noise layers stay silent until a restart.
  private finished = false
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

  // Pause freezes engine/skid sound with the game; only a context that begin() already started is resumed.
  async setPaused(paused: boolean): Promise<void> {
    if (!this.ctx) return
    if (paused && this.ctx.state === 'running') await this.ctx.suspend()
    else if (!paused && this.ctx.state === 'suspended') await this.ctx.resume()
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

  /** Car, surface and race sounds, under the master volume. */
  setSfxVolume(volume: number): void {
    this.sfxVolume = volume
    if (this.ctx && this.sfx) this.sfx.gain.setTargetAtTime(busGain(volume), this.ctx.currentTime, 0.01)
  }

  /** Menu clicks and confirms, under the master volume. */
  setUiVolume(volume: number): void {
    this.uiVolume = volume
    if (this.ctx && this.ui) this.ui.gain.setTargetAtTime(busGain(volume), this.ctx.currentTime, 0.01)
  }

  enableTrace(): void {
    this.trace ??= []
  }

  // Called once per rendered frame with the latest simulation state and the surface under the car.
  update(state: Readonly<CarState>, input: Readonly<CarInput>, material: Material = 'road', onKerb = false): void {
    const ctx = this.ctx
    if (!ctx || !this.engineLow || !this.engineHigh || !this.engineGain || !this.wind || !this.skid) return
    const t = ctx.currentTime
    if (this.finished) {
      for (const g of [this.engineGain, this.wind, this.skid, this.rumble, this.turbo, this.squeal, this.kerb]) g?.gain.setTargetAtTime(0, t, FADE)
      this.endEpisodes()
      return
    }
    const forward = dot(state.velocity, forwardOf(state))
    const ground = length({ x: state.velocity.x, y: 0, z: state.velocity.z })
    const f = engineFreq(forward, input.throttle)
    this.engineLow.frequency.setTargetAtTime(f, t, SMOOTH)
    this.engineHigh.frequency.setTargetAtTime(f * 2.01, t, SMOOTH)
    this.engineGain.gain.setTargetAtTime(0.18 + 0.12 * input.throttle, t, SMOOTH)
    this.wind.gain.setTargetAtTime(windGain(ground), t, SMOOTH)
    this.skid.gain.setTargetAtTime(skidGain(slipAngleDeg(state), ground), t, SMOOTH)
    const sound = SURFACE_SOUND[material]
    this.skidFilter?.frequency.setTargetAtTime(sound.skidHz, t, SMOOTH)
    this.rumbleFilter?.frequency.setTargetAtTime(sound.rumbleHz, t, SMOOTH)
    this.rumble?.gain.setTargetAtTime(rumbleGain(material, ground), t, SMOOTH)
    this.turbo?.gain.setTargetAtTime(turboGain(state.turbo, state.turboForce), t, SMOOTH)
    const slip = slipAngleDeg(state)
    const squeal = squeals(material) ? squealGain(slip, ground) : 0
    this.squealOsc?.frequency.setTargetAtTime(squealFreq(slip), t, SMOOTH)
    this.squeal?.gain.setTargetAtTime(squeal, t, SMOOTH)
    this.squealing = this.episode(this.squealing, 'squeal', squeal)
    const kerb = kerbGain(onKerb, ground)
    this.kerbOsc?.frequency.setTargetAtTime(kerbFreq(ground), t, SMOOTH)
    this.kerb?.gain.setTargetAtTime(kerb, t, SMOOTH)
    this.kerbing = this.episode(this.kerbing, 'kerb', kerb)
    this.checkImpact(state)
  }

  // A sudden velocity change between two frames is a hit (wall, pillar, hard landing): thump by its size.
  private checkImpact(state: Readonly<CarState>): void {
    const v = state.velocity
    const p = state.position
    const lastV = this.lastVel
    const lastP = this.lastPos
    this.lastVel = { x: v.x, y: v.y, z: v.z }
    this.lastPos = { x: p.x, y: p.y, z: p.z }
    if (!lastV || !lastP || Math.hypot(p.x - lastP.x, p.y - lastP.y, p.z - lastP.z) > TELEPORT) return
    const dv = Math.hypot(v.x - lastV.x, v.y - lastV.y, v.z - lastV.z)
    const t = this.ctx!.currentTime
    if (dv <= IMPACT_FLOOR || t - this.lastImpact < IMPACT_GAP) return
    this.lastImpact = t
    this.thump(impactGain(dv))
  }

  // Track a continuous sound's episode for the trace: open it when the gain leaves 0, keep its peak, close at 0.
  private episode(open: AudioTraceEvent | null, kind: 'squeal' | 'kerb', gain: number): AudioTraceEvent | null {
    if (gain <= 0) return null
    if (open) {
      open.level = Math.max(open.level ?? 0, gain)
      return open
    }
    return this.log({ kind, level: gain })
  }

  private endEpisodes(): void {
    this.squealing = null
    this.kerbing = null
  }

  private log(e: Omit<AudioTraceEvent, 't'>): AudioTraceEvent | null {
    if (!this.trace) return null
    const entry = { t: Math.round((this.ctx?.currentTime ?? 0) * 1000), ...e }
    this.trace.push(entry)
    return entry
  }

  // Impact: a low sine drop plus a short low-passed noise burst, both scaled by the hit.
  private thump(gain: number): void {
    const ctx = this.ctx
    if (!ctx || !this.sfx || !this.noise || gain <= 0) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const body = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(110, t)
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18)
    body.gain.setValueAtTime(0.0001, t)
    body.gain.exponentialRampToValueAtTime(gain, t + 0.005)
    body.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(body).connect(this.sfx)
    osc.start(t)
    osc.stop(t + 0.27)
    const burst = ctx.createBufferSource()
    burst.buffer = this.noise
    const crunch = ctx.createBiquadFilter()
    crunch.type = 'lowpass'
    crunch.frequency.value = 1200
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(gain * 0.7, t + 0.003)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    burst.connect(crunch).connect(env).connect(this.sfx)
    burst.start(t)
    burst.stop(t + 0.14)
    this.log({ kind: 'impact', level: gain })
  }

  onCheckpoint(): void {
    this.play('checkpoint')
  }

  onFinish(): void {
    this.finished = true
    this.play('finish')
  }

  // A new personal best: a bright sting after the finish fanfare.
  onNewRecord(): void {
    this.play('newRecord', RECORD_DELAY)
  }

  // Restart (Delete): a new run, so the engine comes back.
  onRestart(): void {
    this.finished = false
    this.resetMotion()
  }

  onRespawn(): void {
    this.resetMotion()
    this.play('respawn')
  }

  /**
   * A menu click or confirm, on the UI bus. A click is a user gesture, so it may create the context itself:
   * the start screen sounds before the race's Begin.
   */
  playUi(sound: UiSound, detail?: string): void {
    if (!this.ctx) this.build(this.createContext())
    const ctx = this.ctx!
    if (ctx.state === 'suspended') void ctx.resume()
    if (!this.ui) return
    const shot = UI_SHOTS[sound]
    let t = ctx.currentTime
    for (const freq of shot.freqs) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(shot.gain, t + 0.004)
      env.gain.exponentialRampToValueAtTime(0.0001, t + shot.duration)
      osc.connect(env).connect(this.ui)
      osc.start(t)
      osc.stop(t + shot.duration + 0.02)
      t += shot.duration
    }
    this.log({ kind: 'ui', detail: detail ? `${sound}:${detail}` : sound })
  }

  // After a respawn or restart the car jumps: no impact from that frame, no squeal or kerb episode carried over.
  private resetMotion(): void {
    this.lastVel = null
    this.lastPos = null
    this.endEpisodes()
  }

  // Start countdown: n = 3, 2, 1 → short low beep; n = 0 (GO) → higher, longer beep.
  onCountdown(n: number): void {
    this.play(n > 0 ? 'countdown' : 'go')
  }

  private play(event: AudioEvent, delay = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.sfx) return
    const shot = ONE_SHOTS[event]
    let t = ctx.currentTime + delay
    for (const freq of shot.freqs) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = shot.type
      osc.frequency.setValueAtTime(freq, t)
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(0.3, t + 0.01)
      env.gain.exponentialRampToValueAtTime(0.0001, t + shot.duration)
      osc.connect(env).connect(this.sfx)
      osc.start(t)
      osc.stop(t + shot.duration + 0.02)
      t += shot.duration
    }
    this.log({ kind: event })
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
    // SFX and UI buses under the master: the Audio tab's two sliders.
    this.sfx = ctx.createGain()
    this.sfx.gain.value = busGain(this.sfxVolume)
    this.sfx.connect(this.master)
    this.ui = ctx.createGain()
    this.ui.gain.value = busGain(this.uiVolume)
    this.ui.connect(this.master)
    this.engineGain.connect(engineFilter).connect(this.sfx)
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
    this.noise = noiseBuffer(ctx)
    noise.buffer = this.noise
    noise.loop = true
    this.wind = ctx.createGain()
    this.wind.gain.value = 0
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 600
    noise.connect(windFilter).connect(this.wind).connect(this.sfx)
    this.skid = ctx.createGain()
    this.skid.gain.value = 0
    const skidFilter = ctx.createBiquadFilter()
    skidFilter.type = 'bandpass'
    skidFilter.frequency.value = 2400
    skidFilter.Q.value = 3
    noise.connect(skidFilter).connect(this.skid).connect(this.sfx)
    this.skidFilter = skidFilter
    // Surface rumble (dirt, grass, ice) and the turbo whoosh: more filtered taps on the same noise.
    this.rumble = ctx.createGain()
    this.rumble.gain.value = 0
    this.rumbleFilter = ctx.createBiquadFilter()
    this.rumbleFilter.type = 'lowpass'
    this.rumbleFilter.frequency.value = 300
    noise.connect(this.rumbleFilter).connect(this.rumble).connect(this.sfx)
    this.turbo = ctx.createGain()
    this.turbo.gain.value = 0
    const turboFilter = ctx.createBiquadFilter()
    turboFilter.type = 'highpass'
    turboFilter.frequency.value = 1500
    noise.connect(turboFilter).connect(this.turbo).connect(this.sfx)
    noise.start()

    // Tyre squeal: a triangle whine wobbled by a 7 Hz vibrato, band-passed so it reads as rubber, not a beep.
    this.squeal = ctx.createGain()
    this.squeal.gain.value = 0
    const squealFilter = ctx.createBiquadFilter()
    squealFilter.type = 'bandpass'
    squealFilter.frequency.value = 1300
    squealFilter.Q.value = 2
    this.squealOsc = ctx.createOscillator()
    this.squealOsc.type = 'triangle'
    this.squealOsc.frequency.value = squealFreq(0)
    const vibrato = ctx.createOscillator()
    vibrato.frequency.value = 7
    const depth = ctx.createGain()
    depth.gain.value = 25
    vibrato.connect(depth).connect(this.squealOsc.frequency)
    this.squealOsc.connect(squealFilter).connect(this.squeal).connect(this.sfx)
    this.squealOsc.start()
    vibrato.start()
    // Kerb rumble: a low square buzz at the stripe rate through a low-pass, the drum of tyres on curb blocks.
    this.kerb = ctx.createGain()
    this.kerb.gain.value = 0
    const kerbFilter = ctx.createBiquadFilter()
    kerbFilter.type = 'lowpass'
    kerbFilter.frequency.value = 220
    this.kerbOsc = ctx.createOscillator()
    this.kerbOsc.type = 'square'
    this.kerbOsc.frequency.value = kerbFreq(0)
    this.kerbOsc.connect(kerbFilter).connect(this.kerb).connect(this.sfx)
    this.kerbOsc.start()
  }
}
