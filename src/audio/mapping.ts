// Pure car-state → sound-parameter mappings. No Web Audio here, so vitest covers them directly.
import { MAX_SPEED, type Material } from '../physics'

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

// Per-surface tyre sound: the skid band-pass centre (Hz) and a rolling rumble (low-passed noise)
// whose gain rises with speed. Road is quiet; dirt and grass rumble low; ice hisses thin and high.
export type SurfaceSound = { skidHz: number; rumbleHz: number; rumbleMax: number }
export const SURFACE_SOUND: Readonly<Record<Material, SurfaceSound>> = {
  road: { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'turbo': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'turbo-red': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  // Effect pads are road underfoot.
  'no-steer': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'engine-off': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'cruise': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'slow-mo': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'fragile': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  'reset': { skidHz: 2400, rumbleHz: 300, rumbleMax: 0 },
  dirt: { skidHz: 900, rumbleHz: 350, rumbleMax: 0.35 },
  grass: { skidHz: 700, rumbleHz: 220, rumbleMax: 0.3 },
  offroad: { skidHz: 650, rumbleHz: 200, rumbleMax: 0.45 },
  ice: { skidHz: 5200, rumbleHz: 4000, rumbleMax: 0.08 },
}

// Rolling rumble gain on a surface at ground speed (m/s): linear in speed up to MAX_SPEED.
export const rumbleGain = (material: Material, speed: number): number =>
  SURFACE_SOUND[material].rumbleMax * clamp01(Math.abs(speed) / MAX_SPEED)

export const TURBO_MAX_GAIN = 0.25

// Turbo whoosh while a pad boost runs: louder for the stronger (red) pad.
export const turboGain = (turboTicks: number, turboForce: number): number =>
  turboTicks > 0 ? TURBO_MAX_GAIN * clamp01(turboForce / 14000) : 0

// Master output gain: 0 when muted, otherwise the clamped volume slider value.
export const masterGain = (muted: boolean, volume: number): number => (muted ? 0 : clamp01(volume))

// Bus gain under the master (the SFX and UI sliders): the clamped slider value, so 0 silences only that bus.
export const busGain = (volume: number): number => clamp01(volume)

// Tyre squeal: a tonal whine on grippy surfaces once the slip passes the skid threshold, louder and higher with slip.
export const SQUEAL_MAX_GAIN = 0.12
// Slip (deg past SKID_SLIP_DEG) at which the squeal is fully loud.
const SQUEAL_SPAN_DEG = 30
const squealSlip = (slipDeg: number): number => Math.min(slipDeg, 180 - slipDeg) - SKID_SLIP_DEG

// Squeal gain from slip angle (deg, 0..180) and ground speed (m/s); 0 at or under the skid threshold.
export const squealGain = (slipDeg: number, speed: number): number => {
  const over = squealSlip(slipDeg)
  if (over <= 0 || Math.abs(speed) <= SKID_MIN_SPEED) return 0
  return SQUEAL_MAX_GAIN * clamp01(over / SQUEAL_SPAN_DEG)
}

// Squeal pitch (Hz): rises from 900 Hz at the threshold to 1500 Hz at full slip.
export const squealFreq = (slipDeg: number): number => 900 + 600 * clamp01(squealSlip(slipDeg) / SQUEAL_SPAN_DEG)

// Surfaces that squeal: hard road (every pad is road underfoot). Loose ground rumbles and ice hisses instead.
export const squeals = (material: Material): boolean => SURFACE_SOUND[material].rumbleMax === 0

// Impact thump from the velocity change (m/s) in one frame: silent under the floor (braking, bumps), full at IMPACT_FULL.
export const IMPACT_FLOOR = 3
export const IMPACT_FULL = 15
export const IMPACT_MAX_GAIN = 0.6
export const impactGain = (dv: number): number => (dv <= IMPACT_FLOOR ? 0 : IMPACT_MAX_GAIN * clamp01((dv - IMPACT_FLOOR) / (IMPACT_FULL - IMPACT_FLOOR)))

// Kerb rumble: a low buzz while a wheel rides the curb band, louder with speed; its pitch follows the stripe rate.
export const KERB_MAX_GAIN = 0.3
export const KERB_MIN_SPEED = 2
export const kerbGain = (onKerb: boolean, speed: number): number =>
  onKerb && Math.abs(speed) > KERB_MIN_SPEED ? KERB_MAX_GAIN * clamp01(0.3 + Math.abs(speed) / MAX_SPEED) : 0
// One bump per 0.5 m of curb: 20 m/s → 40 Hz, clamped to an audible-rumble band.
export const kerbFreq = (speed: number): number => Math.min(90, Math.max(25, Math.abs(speed) * 2))

export type AudioEvent = 'checkpoint' | 'finish' | 'respawn' | 'countdown' | 'go' | 'newRecord'

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
  // Trackmania-style start: three short low beeps (3, 2, 1), then a higher, longer one on GO.
  countdown: { freqs: [440], duration: 0.15, type: 'triangle' },
  go: { freqs: [880], duration: 0.6, type: 'triangle' },
  // New best: a rising major arpeggio an octave above the finish fanfare.
  newRecord: { freqs: [1047, 1319, 1568, 2093], duration: 0.11, type: 'sine' },
}

// UI sounds: short and quiet, so menus feel responsive without competing with the car.
export const UI_MAX_GAIN = 0.12
export type UiSound = 'click' | 'confirm'
export type UiShot = { freqs: readonly number[]; duration: number; gain: number }
export const UI_SHOTS: Readonly<Record<UiSound, UiShot>> = {
  click: { freqs: [1800], duration: 0.025, gain: 0.06 },
  confirm: { freqs: [990, 1480], duration: 0.05, gain: 0.1 },
}
