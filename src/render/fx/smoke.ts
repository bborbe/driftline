// Drift smoke: grey puffs from the rear wheels while the car slides; emission rate follows slip.
import * as THREE from 'three/webgpu'
import { forwardOf, slipAngleDeg, type CarState } from '../../physics'

export const SMOKE_SLIP_DEG = 8 // below this slip nothing is emitted
const FULL_SLIP_DEG = 35 // emission saturates here
export const MAX_SMOKE = 400
const MAX_RATE = 120 // puffs per second at full slip (both wheels)
const LIFE = 1.4 // s
const MIN_SPEED = 3 // m/s
const RIDE_HEIGHT = 0.68
const REAR = -1.4
const HALF_TRACK = 0.8

export type Puff = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; size: number }

/** 0..1 emission intensity for a car state: 0 under SMOKE_SLIP_DEG or when slow / airborne. */
export const smokeIntensity = (s: CarState): number => {
  const speed = Math.hypot(s.velocity.x, s.velocity.z)
  if (speed < MIN_SPEED || Math.abs(s.velocity.y) > 2) return 0
  return Math.min(1, Math.max(0, (slipAngleDeg(s) - SMOKE_SLIP_DEG) / (FULL_SLIP_DEG - SMOKE_SLIP_DEG)))
}

/** Fixed pool of puffs; pure and seeded so it is testable against scripted physics. */
export class SmokePool {
  readonly puffs: Puff[] = []
  private carry = 0
  private seed = 1
  emitted = 0

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 2 ** 32
  }

  update(s: CarState, dt: number): void {
    for (const p of this.puffs) {
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      p.vx *= 1 - 1.5 * dt
      p.vz *= 1 - 1.5 * dt
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) if (this.puffs[i].age >= LIFE) this.puffs.splice(i, 1)

    const k = smokeIntensity(s)
    this.carry += k * MAX_RATE * dt
    if (k === 0) this.carry = 0
    const f = forwardOf(s)
    const h = Math.atan2(f.x, f.z)
    while (this.carry >= 1 && this.puffs.length < MAX_SMOKE) {
      this.carry -= 1
      const side = this.emitted % 2 === 0 ? -1 : 1
      this.puffs.push({
        x: s.position.x + Math.sin(h) * REAR + Math.cos(h) * HALF_TRACK * side,
        y: s.position.y - RIDE_HEIGHT + 0.2,
        z: s.position.z + Math.cos(h) * REAR - Math.sin(h) * HALF_TRACK * side,
        // Puffs keep a fraction of the car's velocity and drift up and sideways.
        vx: s.velocity.x * 0.25 + (this.rand() - 0.5) * 1.5,
        vy: 0.6 + this.rand() * 0.6,
        vz: s.velocity.z * 0.25 + (this.rand() - 0.5) * 1.5,
        age: 0,
        size: 0.5 + 0.5 * k,
      })
      this.emitted++
    }
    if (this.carry > 1) this.carry = 1
  }
}

/** Puff scale over its life: grows from size to ~3x, then shrinks away in the last 30%. */
export const puffScale = (p: Puff): number => {
  const t = p.age / LIFE
  const grow = p.size * (1 + 2 * t)
  return t < 0.7 ? grow : grow * (1 - (t - 0.7) / 0.3)
}

export type Smoke = { object: THREE.InstancedMesh; pool: SmokePool; update: (s: CarState, dt: number, camera: THREE.Camera) => void }

// Radial falloff so a puff reads as a soft blob, not a square.
const softDisc = (): THREE.Texture => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, '#fff')
  r.addColorStop(1, '#000')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export const createSmoke = (): Smoke => {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xe0e0e0, alphaMap: softDisc(), transparent: true, opacity: 0.3, depthWrite: false }),
    MAX_SMOKE,
  )
  mesh.frustumCulled = false
  mesh.count = 0
  const pool = new SmokePool()
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const update = (s: CarState, dt: number, camera: THREE.Camera) => {
    pool.update(s, dt)
    // Billboards: every puff faces the camera.
    pool.puffs.forEach((p, i) => {
      const k = puffScale(p)
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), camera.quaternion, scl.set(k, k, k)))
    })
    mesh.count = pool.puffs.length
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, pool, update }
}
