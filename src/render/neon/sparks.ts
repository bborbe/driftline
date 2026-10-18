// Neon Night spark fountains: a jet of gold sparks just outside each leg of the start arch and every
// upright checkpoint. One InstancedMesh of camera-facing additive quads (one draw call) for every
// fountain. Each spark's flight is a closed-form function of time, so there is no pool to step and
// the motion is the same at any frame rate. Pure placement and flight, tested; nothing reads car state.
import * as THREE from 'three/webgpu'
import { gateLine, gatePillars, gateUp, type Track } from '../../track/schema'

/** Sparks per fountain, their flight time (s), launch speed (m/s), sideways spread (m/s) and size (m). */
export const SPARK = { perFountain: 48, life: 1.1, speed: 8.5, spread: 1.3, size: 0.3 } as const
/** Spark colour, linear and over 1: white-hot gold that clears the neon bloom threshold, so each spark haloes. */
export const SPARK_COLOUR = [4, 2.2, 0.7] as const
const GRAVITY = 9.8
/** A fountain stands this far outside its pillar's outer face, so the jet clears the leg. */
const CLEARANCE = 0.5

export type Fountain = { x: number; y: number; z: number }

/** One fountain beside each pillar of every gate that stands upright on its road (gateUp; not under a loop's top). */
export const sparkFountains = (track: Track): Fountain[] =>
  track.gates.flatMap((gate) => {
    if (gateUp(track, gate) !== 1) return []
    const line = gateLine(track, gate)
    return gatePillars(track, gate).map((p) => {
      const [dx, dz] = [p.x - line.x, p.z - line.z]
      const k = (p.halfWidth + CLEARANCE) / (Math.hypot(dx, dz) || 1)
      return { x: p.x + dx * k, y: p.y, z: p.z + dz * k }
    })
  })

/** A spark's fixed character from its index: launch phase (0..1), sideways direction and speed factor. */
const character = (i: number): [number, number, number] => {
  const h = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  return [h(1), h(2) * Math.PI * 2, 0.75 + h(3) * 0.5]
}

/** Spark `i` of a fountain at time `t` (s): its offset from the fountain and its size (0 at the end of its flight). */
export const sparkAt = (i: number, t: number): { dx: number; dy: number; dz: number; size: number } => {
  const [phase, dir, speed] = character(i)
  const age = (((t / SPARK.life + phase) % 1) + 1) % 1 * SPARK.life
  const side = SPARK.spread * speed
  return {
    dx: Math.cos(dir) * side * age,
    dy: Math.max(0, SPARK.speed * speed * age - 0.5 * GRAVITY * age * age),
    dz: Math.sin(dir) * side * age,
    size: SPARK.size * (1 - age / SPARK.life),
  }
}

/** A round spark: a white-hot core fading to clear, as an alpha texture built in code (no canvas, so it builds headless). */
const sparkDisc = (size = 32): THREE.DataTexture => {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)
      const a = Math.max(0, 1 - r) ** 2
      data.set([255, 255, 255, Math.round(255 * a)], (y * size + x) * 4)
    }
  const tex = new THREE.DataTexture(data, size, size)
  tex.needsUpdate = true
  return tex
}

export type Sparks = { object: THREE.InstancedMesh; update: (time: number, camera: THREE.Camera) => void }

export const createSparks = (track: Track): Sparks => {
  const fountains = sparkFountains(track)
  const count = fountains.length * SPARK.perFountain
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...SPARK_COLOUR, THREE.LinearSRGBColorSpace), map: sparkDisc(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    Math.max(1, count),
  )
  mesh.name = 'neon-sparks'
  mesh.count = count
  mesh.frustumCulled = false
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const update = (time: number, camera: THREE.Camera) => {
    let n = 0
    for (const f of fountains)
      for (let i = 0; i < SPARK.perFountain; i++) {
        const s = sparkAt(i, time)
        mesh.setMatrixAt(n++, m.compose(pos.set(f.x + s.dx, f.y + s.dy, f.z + s.dz), camera.quaternion, scl.setScalar(s.size)))
      }
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, update }
}
