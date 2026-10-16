// Pure car-state → sound-parameter mappings. No Web Audio here, so vitest covers them directly.
import { MAX_SPEED } from '../physics'

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

export const ENGINE_IDLE_HZ = 55
export const ENGINE_MAX_HZ = 220
// Throttle adds load on top of road speed, like revs rising before the car catches up.
const THROTTLE_SHARE = 0.25

// Engine fundamental in Hz from forward speed (m/s, sign ignored) and throttle (0..1).
export const engineFreq = (speed: number, throttle: number): number => {
  const load = clamp01(Math.abs(speed) / MAX_SPEED) * (1 - THROTTLE_SHARE) + clamp01(throttle) * THROTTLE_SHARE
  return ENGINE_IDLE_HZ + (ENGINE_MAX_HZ - ENGINE_IDLE_HZ) * load
}

export const WIND_MAX_GAIN = 0.35

// Wind noise gain: silent at rest, rising with the square of speed to max at MAX_SPEED.
export const windGain = (speed: number): number => WIND_MAX_GAIN * clamp01(Math.abs(speed) / MAX_SPEED) ** 2

export const SKID_SLIP_DEG = 15
export const SKID_MIN_SPEED = 5
export const SKID_MAX_GAIN = 0.5

// Skid noise gain from slip angle (deg, 0..180) and ground speed (m/s).
// Slip near 180° is plain reversing, not a drift, so the angle is folded first.
export const skidGain = (slipDeg: number, speed: number): number => {
  const slip = Math.min(slipDeg, 180 - slipDeg)
  if (slip <= SKID_SLIP_DEG || Math.abs(speed) <= SKID_MIN_SPEED) return 0
  return SKID_MAX_GAIN * clamp01((slip - SKID_SLIP_DEG) / 30)
}

// Master output gain: 0 when muted, otherwise the clamped volume slider value.
export const masterGain = (muted: boolean, volume: number): number => (muted ? 0 : clamp01(volume))

export type AudioEvent = 'checkpoint' | 'finish' | 'respawn'

export type OneShot = {
  freqs: readonly number[] // played in sequence
  duration: number // seconds per note
  type: OscillatorType
}

// Each event gets its own (frequency, duration) signature so they stay distinguishable by ear.
export const ONE_SHOTS: Readonly<Record<AudioEvent, OneShot>> = {
  checkpoint: { freqs: [880, 1320], duration: 0.09, type: 'sine' },
  finish: { freqs: [523, 659, 784, 1047], duration: 0.16, type: 'triangle' },
  respawn: { freqs: [440, 220], duration: 0.14, type: 'square' },
}
