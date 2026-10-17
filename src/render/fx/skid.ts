// Skid marks: dark rear-wheel prints laid while the car slides (slip angle above 15°). They stay on
// the road (a ring buffer of MAX_SKID_MARKS) and sit on it as decals: drawn surface + DECAL_LIFT. The
// height comes from the raycast the physics drives on, so a compressed spring never sinks a mark; the
// physics road sits at the segment pose, the drawn asphalt ROAD_TOP above it, so a road hit is lifted
// by ROAD_TOP (the open ground beside the track is drawn where the physics has it).
import * as THREE from 'three/webgpu'
import { FLAT, forwardOf, slipAngleDeg, v3, type CarState, type Surface } from '../../physics'
import { DECAL_LIFT } from '../track/curbs'
import { ROAD_TOP } from '../track/zones'

export const SKID_SLIP_DEG = 15
export const MAX_SKID_MARKS = 3000
const MIN_SPEED = 3 // m/s
const RIDE_HEIGHT = 0.68 // chassis origin above the road at rest: the fallback when the ray finds no road
const DOWN = v3(0, -1, 0)
const RAY = 3 // m: from the chassis origin down past the wheels
const REAR = -1.3 // rear axle, metres along heading
const HALF_TRACK = 0.8

export type SkidMark = { x: number; y: number; z: number; heading: number }

/** Ring buffer of marks; pure, so the trail is testable against scripted physics. */
export class SkidTrail {
  readonly marks: SkidMark[] = []
  private readonly surface: Surface
  constructor(surface: Surface = FLAT) {
    this.surface = surface
  }
  private next = 0
  total = 0

  get count(): number {
    return this.marks.length
  }

  /** Lay a pair of rear-wheel marks if the car is sliding on the ground. Returns the ring index written, or -1. */
  update(s: CarState): number {
    const speed = Math.hypot(s.velocity.x, s.velocity.z)
    if (speed < MIN_SPEED || Math.abs(s.velocity.y) > 2 || slipAngleDeg(s) <= SKID_SLIP_DEG) return -1
    const f = forwardOf(s)
    const heading = Math.atan2(f.x, f.z)
    const at = this.next
    for (const side of [-1, 1]) {
      // Lateral (left of heading) is (cos h, -sin h), as in schema.ts.
      const x = s.position.x + Math.sin(heading) * REAR + Math.cos(heading) * HALF_TRACK * side
      const z = s.position.z + Math.cos(heading) * REAR - Math.sin(heading) * HALF_TRACK * side
      const hit = this.surface.raycast(v3(x, s.position.y, z), DOWN, RAY)
      const ground = hit ? s.position.y - hit.distance + (hit.material === 'offroad' ? 0 : ROAD_TOP) : s.position.y - RIDE_HEIGHT
      const mark = { x, y: ground + DECAL_LIFT, z, heading }
      if (this.marks.length < MAX_SKID_MARKS) this.marks.push(mark)
      else this.marks[this.next] = mark
      this.next = (this.next + 1) % MAX_SKID_MARKS
      this.total++
    }
    return at
  }
}

export type SkidMarks = { object: THREE.InstancedMesh; trail: SkidTrail; update: (s: CarState) => void }

export const createSkidMarks = (surface?: Surface): SkidMarks => {
  const geo = new THREE.PlaneGeometry(0.28, 0.5)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    MAX_SKID_MARKS,
  )
  mesh.frustumCulled = false
  mesh.count = 0
  const trail = new SkidTrail(surface)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const one = new THREE.Vector3(1, 1, 1)
  const update = (s: CarState) => {
    const at = trail.update(s)
    if (at < 0) return
    for (const i of [at, (at + 1) % MAX_SKID_MARKS]) {
      const k = trail.marks[i]
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(k.x, k.y, k.z), q.setFromAxisAngle(up, k.heading), one))
    }
    mesh.count = trail.count
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, trail, update }
}
