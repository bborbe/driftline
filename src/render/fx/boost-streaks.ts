// Boost streaks: warm radial streaks rushing past the camera while a turbo is active, always on
// (unlike the opt-in ?fx=speedlines, which scale with speed). One instanced mesh in camera space;
// reads only the car's turbo ticks and force, so it costs nothing when no boost runs.
import * as THREE from 'three/webgpu'
import { TICK_HZ, TURBO } from '../../physics'

export const MAX_BOOST_STREAKS = 90
/** Streaks fade out over the last this many seconds of a boost. */
export const BOOST_FADE_S = 0.3

/** Streaks for a boost with `ticks` left at `force` N: the strong (red) pad shows all, yellow 2/3; none without a boost. */
export const boostStreakCount = (ticks: number, force: number): number => {
  if (ticks <= 0 || force <= 0) return 0
  const strength = Math.min(1, force / TURBO['turbo-red'].force)
  const fade = Math.min(1, ticks / (BOOST_FADE_S * TICK_HZ))
  return Math.max(1, Math.round(MAX_BOOST_STREAKS * Math.min(1, 0.33 + strength * 0.67) * fade))
}

const NEAR = 3
const FAR = 45
/** How fast streaks rush toward the camera, m/s (a fixed rush reads as boost whatever the car's speed). */
const RUSH = 90

export type BoostStreaks = { object: THREE.InstancedMesh; update: (ticks: number, force: number, dt: number) => void }

/** Lines live in camera space: add `object` to the camera, and the camera to the scene. */
export const createBoostStreaks = (): BoostStreaks => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.05, 0.05, 7),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.55, depthWrite: false, fog: false }),
    MAX_BOOST_STREAKS,
  )
  mesh.frustumCulled = false
  mesh.count = 0
  // Seeded layout: a ring around the view axis, wide enough to frame the car rather than cross it.
  const lines = Array.from({ length: MAX_BOOST_STREAKS }, (_, i) => {
    const a = (i * 2.399963) % (Math.PI * 2)
    const r = 2.6 + ((i * 7919) % 40) / 10
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 + 0.8, z: NEAR + ((i * 104729) % (FAR - NEAR)) }
  })
  const m = new THREE.Matrix4()
  const update = (ticks: number, force: number, dt: number) => {
    mesh.count = boostStreakCount(ticks, force)
    if (mesh.count === 0) return
    for (let i = 0; i < mesh.count; i++) {
      const l = lines[i]
      l.z -= RUSH * dt
      if (l.z < NEAR) l.z += FAR - NEAR
      mesh.setMatrixAt(i, m.makeTranslation(l.x, l.y, -l.z)) // camera looks down -z
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, update }
}
