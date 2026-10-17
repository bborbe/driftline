// Sparks: short bright streaks thrown off the body where it scrapes a barrier, rail or pillar. Always on — it is
// contact feedback, not an optional effect. Reads car state and the track's obstacles only; physics is untouched.
// The pool is allocated once (MAX_SPARKS objects) and recycled, so a scrape allocates nothing per frame.
import * as THREE from 'three/webgpu'
import { forwardOf, type CarState } from '../../physics'
import type { Pillar } from '../../track/schema'

export const MAX_SPARKS = 240
const MAX_RATE = 360 // sparks per second at full scrape speed
const LIFE = 0.35 // s
export const SPARK_MIN_SPEED = 4 // m/s along the wall; slower contact throws nothing
const FULL_SPEED = 25 // m/s — emission saturates here
const GRAVITY = 9.8
// The body capsule physics collides with (src/physics/car.ts BODY_RADIUS / BODY_REACH): physics pushes the car
// out to exactly this radius, so a car resting on a wall sits within CONTACT_MARGIN of it.
const BODY_RADIUS = 0.9
const BODY_REACH = 1.2
const BODY_SAMPLES = 7
const CONTACT_MARGIN = 0.12
const GRID = 8

export type Spark = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; alive: boolean }

/** Where the body touches an obstacle: the contact point on the wall side and the wall normal (out of the wall). */
export type Contact = { x: number; y: number; z: number; nx: number; nz: number }

type Grid = Map<string, number[]>
const grids = new WeakMap<readonly Pillar[], Grid>()
const cellKey = (i: number, j: number) => `${i},${j}`

// Obstacles bucketed by every grid cell their reach touches, built once per obstacle list.
const gridFor = (obstacles: readonly Pillar[]): Grid => {
  const hit = grids.get(obstacles)
  if (hit) return hit
  const grid: Grid = new Map()
  obstacles.forEach((o, index) => {
    const reach = o.halfWidth + o.halfDepth + BODY_REACH + BODY_RADIUS + CONTACT_MARGIN
    for (let i = Math.floor((o.x - reach) / GRID); i <= Math.floor((o.x + reach) / GRID); i++)
      for (let j = Math.floor((o.z - reach) / GRID); j <= Math.floor((o.z + reach) / GRID); j++) {
        const k = cellKey(i, j)
        const list = grid.get(k)
        if (list) list.push(index)
        else grid.set(k, [index])
      }
  })
  grids.set(obstacles, grid)
  return grid
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The closest obstacle contact within CONTACT_MARGIN of the body capsule, written into `out`; null without one. Same capsule as physics' collide(). */
export const barrierContact = (s: CarState, obstacles: readonly Pillar[] | undefined, out: Contact): Contact | null => {
  if (!obstacles || obstacles.length === 0) return null
  const pos = s.position
  const f = forwardOf(s)
  const flat = Math.hypot(f.x, f.z)
  const fx = flat > 1e-6 ? f.x / flat : 0
  const fz = flat > 1e-6 ? f.z / flat : 1
  const cell = gridFor(obstacles).get(cellKey(Math.floor(pos.x / GRID), Math.floor(pos.z / GRID)))
  if (!cell) return null
  let best = Infinity
  for (const index of cell) {
    const o = obstacles[index]
    if (pos.y < o.y - 1 || pos.y > o.y + o.height) continue
    const ux = Math.sin(o.heading)
    const uz = Math.cos(o.heading)
    for (let i = 0; i < BODY_SAMPLES; i++) {
      const t = (2 * i) / (BODY_SAMPLES - 1) - 1
      const px = pos.x + fx * BODY_REACH * t - o.x
      const pz = pos.z + fz * BODY_REACH * t - o.z
      const u = px * ux + pz * uz
      const w = px * uz - pz * ux
      const du = u - clamp(u, -o.halfDepth, o.halfDepth)
      const dw = w - clamp(w, -o.halfWidth, o.halfWidth)
      const d = Math.hypot(du, dw)
      if (d < 1e-9 || d > BODY_RADIUS + CONTACT_MARGIN || d >= best) continue
      best = d
      out.nx = (du * ux + dw * uz) / d
      out.nz = (du * uz - dw * ux) / d
      // The wall's surface point nearest this body sample.
      out.x = o.x + px - out.nx * d
      out.y = pos.y - 0.2
      out.z = o.z + pz - out.nz * d
    }
  }
  return best === Infinity ? null : out
}

/** Speed along the wall at a contact, m/s. */
export const scrapeSpeed = (s: CarState, c: Contact): number => {
  const vn = s.velocity.x * c.nx + s.velocity.z * c.nz
  return Math.hypot(s.velocity.x - vn * c.nx, s.velocity.z - vn * c.nz)
}

/** Fixed pool of sparks; pure and seeded so it is testable against scripted physics. */
export class SparkPool {
  readonly sparks: readonly Spark[] = Array.from({ length: MAX_SPARKS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, alive: false }))
  private carry = 0
  private seed = 11
  private next = 0
  private readonly contact: Contact = { x: 0, y: 0, z: 0, nx: 0, nz: 0 }
  emitted = 0
  alive = 0

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 2 ** 32
  }

  update(s: CarState, obstacles: readonly Pillar[] | undefined, dt: number): void {
    let alive = 0
    for (let i = 0; i < MAX_SPARKS; i++) {
      const p = this.sparks[i]
      if (!p.alive) continue
      p.age += dt
      if (p.age >= LIFE) {
        p.alive = false
        continue
      }
      p.vy -= GRAVITY * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      alive++
    }
    this.alive = alive

    const c = barrierContact(s, obstacles, this.contact)
    const along = c ? scrapeSpeed(s, c) : 0
    if (!c || along < SPARK_MIN_SPEED) {
      this.carry = 0
      return
    }
    this.carry = Math.min(this.carry + Math.min(1, along / FULL_SPEED) * MAX_RATE * dt, MAX_SPARKS)
    while (this.carry >= 1) {
      this.carry -= 1
      // Ring buffer: the oldest slot is reused when every spark is alive.
      const p = this.sparks[this.next]
      this.next = (this.next + 1) % MAX_SPARKS
      if (!p.alive) this.alive++
      const r = 0.6 + this.rand() * 0.6
      p.x = c.x
      p.y = c.y + this.rand() * 0.3
      p.z = c.z
      // Thrown along the car's travel, kicked off the wall and up.
      p.vx = s.velocity.x * r + c.nx * (1 + this.rand() * 2) + (this.rand() - 0.5) * 2
      p.vy = 1 + this.rand() * 3
      p.vz = s.velocity.z * r + c.nz * (1 + this.rand() * 2) + (this.rand() - 0.5) * 2
      p.age = 0
      p.alive = true
      this.emitted++
    }
  }
}

export type Sparks = { object: THREE.InstancedMesh; pool: SparkPool; update: (s: CarState, dt: number) => void }

export const createSparks = (obstacles: readonly Pillar[] | undefined): Sparks => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    MAX_SPARKS,
  )
  mesh.frustumCulled = false
  mesh.count = 0
  const pool = new SparkPool()
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  const update = (s: CarState, dt: number) => {
    pool.update(s, obstacles, dt)
    let n = 0
    for (let i = 0; i < MAX_SPARKS; i++) {
      const p = pool.sparks[i]
      if (!p.alive) continue
      // A streak along its velocity, shrinking as it cools.
      const speed = Math.hypot(p.vx, p.vy, p.vz)
      q.setFromUnitVectors(Z, dir.set(p.vx, p.vy, p.vz).divideScalar(speed || 1))
      const k = 1 - p.age / LIFE
      mesh.setMatrixAt(n++, m.compose(pos.set(p.x, p.y, p.z), q, scl.set(0.06 * k, 0.06 * k, Math.min(0.8, speed * 0.03) * k + 0.03)))
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, pool, update }
}
