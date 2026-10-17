// Geometry tags, set where a mesh is created and read by the scene geometry lint (lint.ts,
// lint.test.ts). `flat` exempts an intentionally flat piece from the thickness check and says why;
// `kind` marks a structural piece, which must stand on the ground or on something beneath it and is
// solid to the car (a collider covers it) unless `noCollide` says why not. All three enums are
// closed: an unknown value fails the lint, so every exemption stays visible here.
import type * as THREE from 'three/webgpu'

/** Why a piece may be thinner than MIN_THICKNESS (`airborne`: may also hang free). */
export const FLAT_REASONS = ['road', 'curb', 'decal', 'effect-pad', 'screen-face', 'terrain', 'sky', 'ghost-hud', 'particle', 'airborne'] as const
export type FlatReason = (typeof FLAT_REASONS)[number]

/** Structural pieces: each must touch the ground, or rest on something within CONTACT_TOLERANCE. */
export const STRUCTURAL_KINDS = ['wall', 'pillar', 'gate-leg', 'deck', 'ramp-body', 'stand', 'sign'] as const
export type StructuralKind = (typeof STRUCTURAL_KINDS)[number]

/**
 * Why a structural piece has no collider: every other structural part must lie inside the footprint
 * of a box the car collides with (src/physics/surface.ts trackSurface().obstacles), or the lint fails.
 */
export const NO_COLLIDE_REASONS = ['loop-shell'] as const
export type NoCollideReason = (typeof NO_COLLIDE_REASONS)[number]

/** Mark `obj` (and every mesh under it) solid-looking but deliberately not collided with, and say why. */
export const noCollide = <T extends THREE.Object3D>(obj: T, reason: NoCollideReason): T => {
  obj.userData.noCollide = reason
  return obj
}

/** Mark `obj` (and every mesh under it) intentionally flat. */
export const flat = <T extends THREE.Object3D>(obj: T, reason: FlatReason): T => {
  obj.userData.flat = reason
  return obj
}

/** Mark `obj` (and every mesh under it) structural. */
export const structural = <T extends THREE.Object3D>(obj: T, kind: StructuralKind): T => {
  obj.userData.kind = kind
  return obj
}
