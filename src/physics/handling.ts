// Live handling config: every tunable constant of the car, read by step() each tick.
// DEFAULT_HANDLING holds the shipped values; with it in force the sim is bit-identical to the
// literal constants it replaced. The dev tuning panel (src/debug/tuning-panel.ts, ?dev=1) swaps in
// another config with setHandling(). Pure data: no three.js, no browser API.
import type { Material } from './surface'

export type Handling = {
  // Engine
  maxSpeed: number // m/s, engine fades out above it
  maxReverseSpeed: number // m/s
  engineForce: number // N, rear-wheel drive total
  brakeForce: number // N, all wheels total
  reverseForce: number // N, rear-wheel drive total
  driveShare: number // traction control: drive capped to this share of rear grip
  drag: number // aero drag coefficient
  rolling: number // N, rolling resistance
  coastResistance: number // off-throttle coast-down, fraction of wheel load
  turboForce: number // N, green pad push
  turboRedForce: number // N, red pad push
  // Grip
  grip: number // front friction coefficient
  rearGrip: number // rear friction coefficient
  peakSlip: number // rad, slip angle where lateral grip saturates
  handbrakeRearGrip: number // fraction of rear lateral grip kept on handbrake
  handbrakeForce: number // N, rear wheels total
  dirtGrip: number
  dirtDrag: number
  iceGrip: number
  iceDriveGrip: number
  grassGrip: number
  grassDrag: number
  offroadGrip: number
  offroadDrag: number
  offroadMaxSpeed: number // m/s
  // Steering
  maxSteer: number // rad
  steerRate: number // rad/s
  steerSpeedFalloff: number // share of the steer angle lost at maxSpeed
  yawAssist: number // 1/s
  yawAssistSlipLo: number // deg
  yawAssistSlipHi: number // deg
  yawAssistMinSpeed: number // m/s
  // Drift
  driftKick: number // 1/s² per unit steer
  driftKickSlipLo: number // deg
  driftKickSlipHi: number // deg
  driftLimit: number // deg, spin guard while the handbrake is held
  driftLimitFree: number // deg, spin guard once it is released
  driftLimitBand: number // deg
  driftLimitRate: number // 1/s
  driftCarry: number // 1/s per rad of slip
  driftCarryMaxG: number // g, on the handbrake
  driftCarryMaxGFree: number // g, after it
  driftCarrySlipLo: number // deg
  driftCarrySlipHi: number // deg
  driftGripLo: number // material grip where the drift fades out
  driftGripHi: number // material grip where the drift is full
  driftHoldSlip: number // deg of slip held at full steer into the turn
  driftHoldSlipLo: number // deg, the hold starts past this slip
  driftHoldSlipMax: number // deg, no hold past this (a crash or a spin)
  driftHoldMinSpeed: number // m/s, no hold below this (a scrape)
  driftHoldKp: number // 1/s² per rad of slip error
  driftHoldKd: number // 1/s, damping on the slip rate
  driftHoldRelease: number // fraction of the hold gain that straightens the slide when steer is neutral
  driftHoldNeutral: number // |steer| under this counts as straightened
  // Air and suspension
  gravity: number // m/s²
  spring: number // N/m
  damper: number // N·s/m
}

export const DEFAULT_HANDLING: Readonly<Handling> = Object.freeze({
  maxSpeed: 40,
  maxReverseSpeed: 10,
  engineForce: 9000,
  brakeForce: 16000,
  reverseForce: 6000,
  driveShare: 0.75,
  drag: 0.45,
  rolling: 30,
  coastResistance: 0.3,
  turboForce: 7000,
  turboRedForce: 14000,
  grip: 1.6,
  rearGrip: 2.0,
  peakSlip: 0.15,
  handbrakeRearGrip: 0.3,
  handbrakeForce: 3000,
  dirtGrip: 0.6,
  dirtDrag: 0.04,
  iceGrip: 0.18,
  iceDriveGrip: 0.55,
  grassGrip: 0.5,
  grassDrag: 0.12,
  offroadGrip: 0.45,
  offroadDrag: 0.1,
  offroadMaxSpeed: 10,
  maxSteer: 0.5,
  steerRate: 4,
  steerSpeedFalloff: 0.5,
  yawAssist: 12,
  yawAssistSlipLo: 8,
  yawAssistSlipHi: 15,
  yawAssistMinSpeed: 5,
  driftKick: 6,
  driftKickSlipLo: 20,
  driftKickSlipHi: 30,
  driftLimit: 26,
  driftLimitFree: 18,
  driftLimitBand: 6,
  driftLimitRate: 25,
  driftCarry: 4,
  driftCarryMaxG: 1.2,
  driftCarryMaxGFree: 0.6,
  driftCarrySlipLo: 10,
  driftCarrySlipHi: 15,
  driftGripLo: 0.6,
  driftGripHi: 1,
  driftHoldSlip: 20,
  driftHoldSlipLo: 10,
  driftHoldSlipMax: 45,
  driftHoldMinSpeed: 18,
  driftHoldKp: 80,
  driftHoldKd: 10,
  driftHoldRelease: 0.5,
  driftHoldNeutral: 0.2,
  gravity: 9.81,
  spring: 40000,
  damper: 4500,
})

export type HandlingKey = keyof Handling
export const HANDLING_KEYS = Object.keys(DEFAULT_HANDLING) as HandlingKey[]

// Per-material handling. `grip` scales the tyre friction coefficient; `drag` is extra rolling
// resistance as a fraction of wheel load, always on (grass and dirt bog the car down).
// `driveGrip` (default `grip`) scales the friction available to the engine on its own, so ice
// keeps most of its acceleration while losing side grip, Trackmania-style; brakes still use `grip`.
// `maxSpeed` (m/s, default maxSpeed) caps what the engine drives a wheel to on that material;
// above it the wheel is braked by OVERSPEED_DRAG, so diving onto it at speed bleeds speed fast.
export type MaterialHandling = { grip: number; drag: number; maxSpeed?: number; driveGrip?: number }

export const materialsOf = (h: Readonly<Handling>): Readonly<Record<Material, MaterialHandling>> => ({
  road: { grip: 1, drag: 0 },
  'turbo': { grip: 1, drag: 0 },
  'turbo-red': { grip: 1, drag: 0 },
  // Effect pads drive like road; their effect is applied to the input by src/race/effects.ts.
  'no-steer': { grip: 1, drag: 0 },
  'engine-off': { grip: 1, drag: 0 },
  'cruise': { grip: 1, drag: 0 },
  'slow-mo': { grip: 1, drag: 0 },
  'fragile': { grip: 1, drag: 0 },
  'reset': { grip: 1, drag: 0 },
  dirt: { grip: h.dirtGrip, drag: h.dirtDrag },
  ice: { grip: h.iceGrip, drag: 0, driveGrip: h.iceDriveGrip },
  grass: { grip: h.grassGrip, drag: h.grassDrag },
  // Off-track ground, Trackmania-style: cutting across the field never beats the road.
  offroad: { grip: h.offroadGrip, drag: h.offroadDrag, maxSpeed: h.offroadMaxSpeed },
})

let current: Readonly<Handling> = DEFAULT_HANDLING
let currentMaterials = materialsOf(DEFAULT_HANDLING)

/** The config step() uses this tick. */
export const handling = (): Readonly<Handling> => current
export const materials = (): Readonly<Record<Material, MaterialHandling>> => currentMaterials

/** Swaps the live config; the next physics tick uses it. */
export const setHandling = (h: Readonly<Handling>): void => {
  current = Object.freeze({ ...h })
  currentMaterials = materialsOf(current)
}

export const resetHandling = (): void => setHandling(DEFAULT_HANDLING)

/** True when any value differs from the shipped default. */
export const isTuned = (h: Readonly<Handling> = current): boolean => HANDLING_KEYS.some((k) => h[k] !== DEFAULT_HANDLING[k])

/** The full config as pretty JSON, for "Copy JSON". */
export const handlingToJson = (h: Readonly<Handling> = current): string => JSON.stringify(h, null, 2)

/**
 * Parses a config from JSON: known keys with finite numbers are taken, anything else is ignored,
 * missing keys keep their default. Returns null for text that is not a JSON object.
 */
export const handlingFromJson = (text: string): Handling | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const src = parsed as Record<string, unknown>
  const h: Handling = { ...DEFAULT_HANDLING }
  for (const k of HANDLING_KEYS) {
    const v = src[k]
    if (typeof v === 'number' && Number.isFinite(v)) h[k] = v
  }
  return h
}
