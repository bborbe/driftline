// Dev tuning (?dev=1): slider ranges for every handling constant, persistence of a tune in localStorage,
// and the run taint that keeps tuned runs out of records and ghosts. Pure and tested; the DOM panel is
// src/debug/tuning-panel.ts.
import { DEFAULT_HANDLING, handlingFromJson, handlingToJson, isTuned, type Handling, type HandlingKey } from '../physics/handling'

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface Slider {
  key: HandlingKey
  label: string
  min: number
  max: number
  step: number
}

export interface SliderGroup {
  title: string
  sliders: Slider[]
}

const s = (key: HandlingKey, label: string, min: number, max: number, step: number): Slider => ({ key, label, min, max, step })

/** Every key of Handling, once, grouped as the panel shows them (tuning.test.ts checks the coverage). */
export const TUNING_GROUPS: SliderGroup[] = [
  {
    title: 'Engine',
    sliders: [
      s('maxSpeed', 'Top speed (m/s)', 10, 80, 0.5),
      s('maxReverseSpeed', 'Reverse top speed (m/s)', 2, 30, 0.5),
      s('engineForce', 'Engine force (N)', 1000, 30000, 100),
      s('brakeForce', 'Brake force (N)', 2000, 40000, 100),
      s('reverseForce', 'Reverse force (N)', 1000, 20000, 100),
      s('driveShare', 'Traction control share', 0.1, 1.5, 0.01),
      s('drag', 'Aero drag', 0, 2, 0.01),
      s('rolling', 'Rolling resistance (N)', 0, 200, 1),
      s('coastResistance', 'Coast-down', 0, 1, 0.01),
      s('turboForce', 'Turbo force (N)', 0, 30000, 100),
      s('turboRedForce', 'Red turbo force (N)', 0, 40000, 100),
    ],
  },
  {
    title: 'Grip',
    sliders: [
      s('grip', 'Front grip', 0.2, 4, 0.01),
      s('rearGrip', 'Rear grip', 0.2, 4, 0.01),
      s('peakSlip', 'Peak slip (rad)', 0.02, 0.6, 0.005),
      s('handbrakeRearGrip', 'Handbrake rear grip', 0, 1, 0.01),
      s('handbrakeForce', 'Handbrake force (N)', 0, 15000, 100),
      s('dirtGrip', 'Dirt grip', 0, 1.5, 0.01),
      s('dirtDrag', 'Dirt drag', 0, 0.5, 0.005),
      s('iceGrip', 'Ice grip', 0, 1, 0.01),
      s('iceDriveGrip', 'Ice drive grip', 0, 1.5, 0.01),
      s('grassGrip', 'Grass grip', 0, 1.5, 0.01),
      s('grassDrag', 'Grass drag', 0, 0.5, 0.005),
      s('offroadGrip', 'Offroad grip', 0, 1.5, 0.01),
      s('offroadDrag', 'Offroad drag', 0, 0.5, 0.005),
      s('offroadMaxSpeed', 'Offroad top speed (m/s)', 2, 40, 0.5),
    ],
  },
  {
    title: 'Steering',
    sliders: [
      s('maxSteer', 'Max steer angle (rad)', 0.1, 1.2, 0.01),
      s('steerRate', 'Steer speed (rad/s)', 0.5, 15, 0.1),
      s('steerSpeedFalloff', 'Steer loss at top speed', 0, 0.95, 0.01),
      s('yawAssist', 'Yaw assist (1/s)', 0, 40, 0.5),
      s('yawAssistSlipLo', 'Yaw assist fade from (°)', 0, 45, 0.5),
      s('yawAssistSlipHi', 'Yaw assist off at (°)', 0, 60, 0.5),
      s('yawAssistMinSpeed', 'Yaw assist min speed (m/s)', 0, 30, 0.5),
    ],
  },
  {
    title: 'Drift',
    sliders: [
      s('driftKick', 'Handbrake kick', 0, 30, 0.1),
      s('driftKickSlipLo', 'Kick fades from (°)', 0, 60, 0.5),
      s('driftKickSlipHi', 'Kick off at (°)', 0, 90, 0.5),
      s('driftLimit', 'Spin guard, handbrake held (°)', 5, 90, 0.5),
      s('driftLimitFree', 'Spin guard, released (°)', 5, 90, 0.5),
      s('driftLimitBand', 'Spin guard band (°)', 0.5, 40, 0.5),
      s('driftLimitRate', 'Spin guard rate (1/s)', 0, 80, 0.5),
      s('driftCarry', 'Slide carry (1/s)', 0, 20, 0.1),
      s('driftCarryMaxG', 'Slide carry max, handbrake (g)', 0, 6, 0.05),
      s('driftCarryMaxGFree', 'Slide carry max, released (g)', 0, 6, 0.05),
      s('driftCarrySlipLo', 'Carry from (°)', 0, 45, 0.5),
      s('driftCarrySlipHi', 'Carry full at (°)', 0, 60, 0.5),
      s('driftGripLo', 'Drift off below grip', 0, 1.5, 0.01),
      s('driftGripHi', 'Drift full from grip', 0, 1.5, 0.01),
      s('driftHoldSlip', 'Hold: slip at full steer (°)', 0, 45, 0.5),
      s('driftHoldSlipLo', 'Hold from slip (°)', 0, 30, 0.5),
      s('driftHoldSlipMax', 'Hold off past slip (°)', 10, 90, 0.5),
      s('driftHoldMinSpeed', 'Hold off below (m/s)', 0, 40, 0.5),
      s('driftHoldKp', 'Hold strength (1/s²)', 0, 300, 1),
      s('driftHoldKd', 'Hold damping (1/s)', 0, 60, 0.5),
      s('driftHoldRelease', 'Straighten pull (× hold)', 0, 2, 0.05),
      s('driftHoldNeutral', 'Straight steer under', 0, 1, 0.01),
    ],
  },
  {
    title: 'Air',
    sliders: [
      s('gravity', 'Gravity (m/s²)', 1, 30, 0.01),
      s('spring', 'Suspension spring (N/m)', 5000, 150000, 500),
      s('damper', 'Landing damping (N·s/m)', 500, 20000, 50),
    ],
  },
]

/** `?dev=1` turns on the tuning panel (F2) and loads the stored tune. */
export const devMode = (search: string): boolean => new URLSearchParams(search).get('dev') === '1'

/** F2 opens and closes the tuning panel (dev mode only). */
export const isTuningKey = (code: string): boolean => code === 'F2'

const TUNING_KEY = 'driftline-tuning'

/** The stored tune, or null when none is stored (or it does not parse). */
export const loadTuning = (storage: KeyValueStore): Handling | null => {
  const text = storage.getItem(TUNING_KEY)
  return text === null ? null : handlingFromJson(text)
}

/** Stores a tune; a tune equal to the defaults clears the key, so a reset leaves nothing behind. */
export const saveTuning = (storage: KeyValueStore, h: Readonly<Handling>): void => {
  if (isTuned(h)) storage.setItem(TUNING_KEY, handlingToJson(h))
  else storage.removeItem(TUNING_KEY)
}

/** A copy of `h` with one group's keys back at their defaults. */
export const resetGroup = (h: Readonly<Handling>, group: SliderGroup): Handling => {
  const next = { ...h }
  for (const sl of group.sliders) next[sl.key] = DEFAULT_HANDLING[sl.key]
  return next
}

/**
 * Whether the current run may set records: a run is tainted once any tick ran with a tune, and stays
 * tainted until the next run starts with defaults (lap start or restart), so tuning mid-lap and
 * resetting before the line still saves nothing.
 */
export class RunTaint {
  private tainted = false

  /** Call each frame with whether the live config is tuned. */
  observe(tuned: boolean): void {
    if (tuned) this.tainted = true
  }

  /** Call when a run starts. */
  runStart(tuned: boolean): void {
    this.tainted = tuned
  }

  get locked(): boolean {
    return this.tainted
  }
}
