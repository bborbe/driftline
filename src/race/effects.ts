// Trackmania-style effect pads: driving onto one changes the driver's input until a reset pad,
// a respawn, a restart or the finish. Effects never touch the handling model — they gate the
// CarInput fed to step(), so the ghost records the gated input and replays it with no effect logic.
// Pure and tick-driven: no three.js, no clocks, no randomness.
import { dot, forwardOf, groundUnder, type CarInput, type CarState, type Surface, type Vec3 } from '../physics'
import { isEffect, type EffectKind } from '../track/schema'

/** Slow-motion pad: sim time per tick. Ticks (and the lap timer) still run at 100 Hz real time. */
export const SLOW_MO_SCALE = 0.5

/** Fragile pad: a landing at this speed (m/s) or more along the surface normal breaks the car. */
export const FRAGILE_IMPACT = 7

/** A broken (fragile) car keeps this share of its steering and throttle. */
export const BROKEN_STEER = 0.3
export const BROKEN_THROTTLE = 0.5

/** Cruise: throttle / brake per m/s under / over the locked speed. */
const CRUISE_GAIN = 2
const CRUISE_BRAKE_GAIN = 0.5

/** Below this forward speed (m/s) brake input reverses (car.ts STOPPED); engine-off allows no reverse. */
const STOPPED = 0.5

/** What the HUD shows: one entry per active effect, in a fixed order. */
export type ActiveEffect = 'no-steer' | 'engine-off' | 'cruise' | 'slow-mo' | 'fragile' | 'broken'

export class Effects {
  noSteer = false
  /** Engine mode: cruise and engine-off replace each other. */
  engine: 'on' | 'off' | 'cruise' = 'on'
  /** Cruise target speed (m/s, forward), locked on pad entry. */
  cruiseSpeed = 0
  slowMo = false
  fragile: 'off' | 'armed' | 'broken' = 'off'

  private lastMaterial: string | null = null
  private wasAirborne = false

  /** Clears every effect (reset pad, respawn, restart, finish). */
  clear(): void {
    this.noSteer = false
    this.engine = 'on'
    this.cruiseSpeed = 0
    this.slowMo = false
    this.fragile = 'off'
  }

  /** True while any effect is active. */
  get any(): boolean {
    return this.noSteer || this.engine !== 'on' || this.slowMo || this.fragile !== 'off'
  }

  /** Active effects in a fixed order, for the HUD. */
  active(): ActiveEffect[] {
    const out: ActiveEffect[] = []
    if (this.noSteer) out.push('no-steer')
    if (this.engine === 'off') out.push('engine-off')
    if (this.engine === 'cruise') out.push('cruise')
    if (this.slowMo) out.push('slow-mo')
    if (this.fragile === 'armed') out.push('fragile')
    if (this.fragile === 'broken') out.push('broken')
    return out
  }

  /** Apply the pad `kind` the car just drove onto, with `speed` its forward speed. */
  trigger(kind: EffectKind, speed: number): void {
    switch (kind) {
      case 'no-steer':
        this.noSteer = true
        break
      case 'engine-off':
        this.engine = 'off'
        break
      case 'cruise':
        this.engine = 'cruise'
        this.cruiseSpeed = speed
        break
      case 'slow-mo':
        this.slowMo = true
        break
      case 'fragile':
        if (this.fragile === 'off') this.fragile = 'armed'
        break
      case 'reset':
        this.clear()
        break
    }
  }

  /**
   * Read the ground under the car about to be stepped: a pad entered this tick triggers its effect
   * (once, on entry), and an armed fragile car breaks on a hard landing. `s.velocity` on the first
   * grounded tick after the air is the pre-impact velocity: the ground has not acted on it yet.
   */
  observe(s: CarState, surface: Surface): void {
    const ground = groundUnder(s, surface)
    const airborne = ground.contacts === 0
    if (!airborne && this.wasAirborne && this.fragile === 'armed' && impactSpeed(s.velocity, ground.normal) >= FRAGILE_IMPACT) {
      this.fragile = 'broken'
    }
    this.wasAirborne = airborne
    const material = airborne ? null : ground.material
    if (material !== null && material !== this.lastMaterial && isEffect(material)) this.trigger(material, forwardSpeed(s))
    this.lastMaterial = material
  }

  /** The input step() gets: `input` with the active effects applied. Returns `input` itself when none is active. */
  gate(input: CarInput, s: CarState): CarInput {
    if (!this.any) return input
    let { throttle, brake, steer } = input
    if (this.noSteer) steer = 0
    if (this.engine === 'off') {
      throttle = 0
      if (forwardSpeed(s) < STOPPED) brake = 0
    }
    if (this.engine === 'cruise') {
      const err = this.cruiseSpeed - forwardSpeed(s)
      throttle = clamp01(err * CRUISE_GAIN)
      brake = clamp01(-err * CRUISE_BRAKE_GAIN)
    }
    if (this.fragile === 'broken') {
      steer *= BROKEN_STEER
      throttle *= BROKEN_THROTTLE
    }
    const gated: CarInput = { ...input, throttle, brake, steer }
    if (this.slowMo) gated.timeScale = SLOW_MO_SCALE
    return gated
  }
}

/** Speed into the surface along its normal (0 when moving away from it). */
export const impactSpeed = (velocity: Vec3, normal: Vec3): number => Math.max(0, -dot(velocity, normal))

const forwardSpeed = (s: CarState): number => dot(s.velocity, forwardOf(s))

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
