// Drift cue: a faint glow under the car while it holds a good drift angle — feedback, not a score. Always on.
// The glow copies the car mesh's pose each frame, so it follows the body on banks, loops and wallrides. It is not a
// child of the car: the first livery paint (car/paint.ts) repaints every mesh under the car root. Reads car state only.
import * as THREE from 'three/webgpu'
import { slipAngleDeg, type CarState } from '../../physics'

/** The good-drift band: slip angle in degrees, at or above DRIFT_CUE_MIN_SPEED. */
export const DRIFT_CUE_MIN_DEG = 15
export const DRIFT_CUE_MAX_DEG = 35
export const DRIFT_CUE_MIN_SPEED = 10 // m/s
/** Peak glow opacity — subtle by design. */
export const DRIFT_CUE_MAX_OPACITY = 0.5
const RISE = 6 // 1/s — fades in over ~0.2 s
const FALL = 4 // 1/s — fades out over ~0.3 s
const UNDER = -0.6 // m below the body origin, just above the road
const COLOR = 0x40e0ff

/** True while the car is in the good-drift band. */
export const inDriftBand = (s: CarState): boolean => {
  if (Math.hypot(s.velocity.x, s.velocity.z) < DRIFT_CUE_MIN_SPEED) return false
  const slip = slipAngleDeg(s)
  return slip >= DRIFT_CUE_MIN_DEG && slip <= DRIFT_CUE_MAX_DEG
}

/** 0..1 cue level, eased toward 1 in the band and toward 0 outside it, so a flicker across an edge does not blink. */
export class DriftCue {
  level = 0

  update(s: CarState, dt: number): number {
    const target = inDriftBand(s) ? 1 : 0
    const rate = target > this.level ? RISE : FALL
    this.level += (target - this.level) * Math.min(1, rate * dt)
    if (this.level < 1e-3) this.level = 0
    return this.level
  }
}

// A soft ring just outside the body's footprint: the centre sits under the car, where it would not be seen.
const glowTexture = (): THREE.Texture => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, '#000')
  r.addColorStop(0.45, '#333')
  r.addColorStop(0.7, '#fff')
  r.addColorStop(1, '#000')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export type DriftGlow = { object: THREE.Object3D; cue: DriftCue; update: (s: CarState, dt: number, car: THREE.Object3D) => void }

export const createDriftGlow = (): DriftGlow => {
  const material = new THREE.MeshBasicMaterial({
    color: COLOR,
    alphaMap: glowTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 7.2), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = UNDER
  const root = new THREE.Group()
  root.add(mesh)
  root.visible = false
  const cue = new DriftCue()
  const update = (s: CarState, dt: number, car: THREE.Object3D) => {
    const k = cue.update(s, dt)
    material.opacity = k * DRIFT_CUE_MAX_OPACITY
    root.visible = k > 0
    if (root.visible) {
      root.position.copy(car.position)
      root.quaternion.copy(car.quaternion)
    }
  }
  return { object: root, cue, update }
}
