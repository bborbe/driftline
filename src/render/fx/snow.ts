// Snow: soft flakes drifting down through a box around the camera, the same cheap way as rain
// (fx/rain.ts): flakes hold still in the world apart from their fall and sway, and each wraps into
// the box as the camera moves. Slower, larger and whiter than rain's streaks. One instanced draw call.
import * as THREE from 'three/webgpu'
import { dropCoord, wrap } from './rain'

export const SNOW_FLAKES = 1200
/** Box around the camera the flakes fill, metres (x, y, z): smaller than rain's, as slow flakes far off read as haze. */
export const SNOW_BOX = [40, 20, 40] as const
/** Fall speed in m/s (rain falls at 16). */
export const SNOW_SPEED = 1.8
/** Sideways sway: amplitude in metres; angular speed in rad/s, phase per flake. */
export const SNOW_SWAY = 0.6
const SWAY_RATE = 1.3
/** Flake radius, metres: drawn 0.08–0.12 m across. */
const FLAKE = 0.05

/** Sideways offset of a flake with phase `phase` at time `t`: bounded by SNOW_SWAY. */
export const sway = (phase: number, t: number): number => SNOW_SWAY * Math.sin(phase + SWAY_RATE * t)

export type Snow = { object: THREE.InstancedMesh; update: (dt: number, camera: THREE.Camera) => void }

export const createSnow = (seed = 1): Snow => {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(FLAKE, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    SNOW_FLAKES,
  )
  mesh.name = 'snow'
  mesh.frustumCulled = false
  // Seeded offsets, phases and sizes (mulberry32), so every load snows the same.
  let s = seed
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const flakes = Array.from({ length: SNOW_FLAKES }, () => ({
    o: [rand() * SNOW_BOX[0], rand() * SNOW_BOX[1], rand() * SNOW_BOX[2]],
    phase: rand() * Math.PI * 2,
    size: 0.8 + rand() * 0.4,
  }))
  const m = new THREE.Matrix4()
  const cam = new THREE.Vector3()
  let time = 0
  const update = (dt: number, camera: THREE.Camera) => {
    camera.getWorldPosition(cam)
    time += dt
    for (let i = 0; i < SNOW_FLAKES; i++) {
      const f = flakes[i]
      f.o[1] = wrap(f.o[1] - SNOW_SPEED * dt, SNOW_BOX[1])
      m.makeScale(f.size, f.size, f.size)
      m.setPosition(
        dropCoord(f.o[0], cam.x, SNOW_BOX[0]) + sway(f.phase, time),
        dropCoord(f.o[1], cam.y, SNOW_BOX[1]),
        dropCoord(f.o[2], cam.z, SNOW_BOX[2]) + sway(f.phase * 1.7, time * 0.8),
      )
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, update }
}
