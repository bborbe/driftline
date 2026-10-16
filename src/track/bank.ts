// Banked-turn cross-slope, shared by physics (src/physics/surface.ts) and render
// (src/render/track/geometry.ts) so the drivable surface and the drawn road never disagree.
// Pure TypeScript: no three, no browser APIs, so physics may import it.
//
// The bank pivots on the CENTRELINE and eases in and out over BANK_EASE of the turn at each
// end, so both joints are flat and continuous. Mid-turn the inner half dips below the road
// plane by up to (w/2)·tan(bank); the renderer draws an apron there. An inner-edge pivot was
// measured and rejected: it lifts the centreline as the bank comes in, and on lap1's banked
// turn the car then loses contact at race speed (14 m/s).
import type { Segment } from './schema'

/** Fraction of a banked turn spent rolling in, and again rolling out. */
export const BANK_EASE = 0.3

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const smoothstep = (e: number): number => e * e * (3 - 2 * e)

/** Bank angle (radians) at sweep fraction t in [0, 1] of a turn whose full bank is `bank`. */
export const bankAngleAt = (bank: number, t: number): number =>
  bank * smoothstep(clamp01(Math.min(t, 1 - t) / BANK_EASE))

/** d(bankAngleAt)/dt, for surface gradients. */
export const bankAngleSlope = (bank: number, t: number): number => {
  const e = Math.min(t, 1 - t) / BANK_EASE
  if (e <= 0 || e >= 1) return 0
  const de = (t < 0.5 ? 1 : -1) / BANK_EASE
  return bank * 6 * e * (1 - e) * de
}

/** Height above the road plane at `outward` metres out from the centreline (negative = inward), for bank angle `angle`. */
export const bankRise = (angle: number, outward: number): number => outward * Math.tan(angle)

/**
 * Height above the road plane of a banked segment at sweep fraction t and radius r
 * (distance from the turn centre). Zero for every non-banked segment.
 */
export const bankHeight = (seg: Segment, t: number, r: number): number =>
  seg.type === 'banked' ? bankRise(bankAngleAt(seg.bank, t), r - seg.radius) : 0
