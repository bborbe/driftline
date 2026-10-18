// Dust: brown puffs kicked up behind the rear wheels on dirt and off-track ground (a little on grass), rising with
// speed. Always on — it is surface feedback, not an optional effect. Shares the puff shape with smoke.
import * as THREE from 'three/webgpu'
import { forwardOf, type CarState, type Material } from '../../physics'
import { puffScale, softDisc, type Puff } from './smoke'

export const MAX_DUST = 300
const MAX_RATE = 90 // puffs per second at full intensity (both wheels)
const LIFE = 1.4 // s — puffScale() assumes the smoke life, so keep them equal
const MIN_SPEED = 3 // m/s
const FULL_SPEED = 25 // m/s — emission saturates here
const RIDE_HEIGHT = 0.68
const REAR = -1.4
const HALF_TRACK = 0.8

/** How strongly a surface throws dust, 0..1. */
export const DUST_PER_MATERIAL: Readonly<Record<Material, number>> = {
  road: 0,
  'turbo': 0,
  'turbo-red': 0,
  'no-steer': 0,
  'engine-off': 0,
  'cruise': 0,
  'slow-mo': 0,
  'fragile': 0,
  'reset': 0,
  dirt: 1,
  grass: 0.35,
  offroad: 0.6,
  ice: 0,
}

/** 0..1 emission intensity: surface strength times speed, 0 when slow or airborne. */
export const dustIntensity = (s: CarState, material: Material): number => {
  const speed = Math.hypot(s.velocity.x, s.velocity.z)
  if (speed < MIN_SPEED || Math.abs(s.velocity.y) > 2) return 0
  return DUST_PER_MATERIAL[material] * Math.min(1, speed / FULL_SPEED)
}

/** Fixed pool of puffs; pure and seeded so it is testable against scripted physics. */
export class DustPool {
  readonly puffs: Puff[] = []
  private carry = 0
  /** Particle budget (Settings → Graphics quality): scales the emission rate and the live-puff cap. */
  scale = 1
  private seed = 7
  emitted = 0

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 2 ** 32
  }

  update(s: CarState, material: Material, dt: number): void {
    for (const p of this.puffs) {
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      p.vx *= 1 - 2 * dt
      p.vz *= 1 - 2 * dt
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) if (this.puffs[i].age >= LIFE) this.puffs.splice(i, 1)

    const k = dustIntensity(s, material)
    this.carry += k * MAX_RATE * this.scale * dt
    if (k === 0) this.carry = 0
    const f = forwardOf(s)
    const h = Math.atan2(f.x, f.z)
    const cap = Math.round(MAX_DUST * this.scale)
    while (this.carry >= 1 && this.puffs.length < cap) {
      this.carry -= 1
      const side = this.emitted % 2 === 0 ? -1 : 1
      this.puffs.push({
        x: s.position.x + Math.sin(h) * REAR + Math.cos(h) * HALF_TRACK * side,
        y: s.position.y - RIDE_HEIGHT + 0.15,
        z: s.position.z + Math.cos(h) * REAR - Math.sin(h) * HALF_TRACK * side,
        // Thrown back off the tyres: slower than the car, low and wide.
        vx: s.velocity.x * 0.15 + (this.rand() - 0.5) * 2,
        vy: 0.3 + this.rand() * 0.5,
        vz: s.velocity.z * 0.15 + (this.rand() - 0.5) * 2,
        age: 0,
        size: 0.5 + 0.6 * k,
      })
      this.emitted++
    }
    if (this.carry > 1) this.carry = 1
  }
}

export type Dust = { object: THREE.InstancedMesh; pool: DustPool; update: (s: CarState, material: Material, dt: number, camera: THREE.Camera) => void }

export const createDust = (): Dust => {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x9a7650, alphaMap: softDisc(), transparent: true, opacity: 0.35, depthWrite: false }),
    MAX_DUST,
  )
  mesh.frustumCulled = false
  mesh.count = 0
  const pool = new DustPool()
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const update = (s: CarState, material: Material, dt: number, camera: THREE.Camera) => {
    pool.update(s, material, dt)
    pool.puffs.forEach((p, i) => {
      const k = puffScale(p)
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), camera.quaternion, scl.set(k, k, k)))
    })
    mesh.count = pool.puffs.length
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, pool, update }
}
