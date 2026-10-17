// Rain: thin streaks falling through a box around the camera. The drops hold still in the world
// (the car drives through them); each one's position wraps into the box as the camera moves, so a
// fixed, small number of drops fills the view wherever it is. One instanced draw call.
import * as THREE from 'three/webgpu'

export const RAIN_DROPS = 1500
/** Box around the camera the drops fill, metres (x, y, z). */
export const RAIN_BOX = [50, 24, 50] as const
/** Fall speed in m/s, and the streak length that speed reads as. */
export const RAIN_SPEED = 16
const STREAK = 0.7

/** `v` wrapped into [0, size). */
export const wrap = (v: number, size: number): number => ((v % size) + size) % size

/** World coordinate of a drop at box offset `o` (0..size) for a camera at `c`: within ±size/2 of it. */
export const dropCoord = (o: number, c: number, size: number): number => c - size / 2 + wrap(o - c + size / 2, size)

export type Rain = { object: THREE.InstancedMesh; update: (dt: number, camera: THREE.Camera) => void }

export const createRain = (seed = 1): Rain => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.02, STREAK, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0.4, depthWrite: false }),
    RAIN_DROPS,
  )
  mesh.name = 'rain'
  mesh.frustumCulled = false
  // Seeded offsets inside the box (mulberry32), so every load rains the same.
  let s = seed
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const drops = Array.from({ length: RAIN_DROPS }, () => [rand() * RAIN_BOX[0], rand() * RAIN_BOX[1], rand() * RAIN_BOX[2]])
  const m = new THREE.Matrix4()
  const cam = new THREE.Vector3()
  const update = (dt: number, camera: THREE.Camera) => {
    camera.getWorldPosition(cam)
    for (let i = 0; i < RAIN_DROPS; i++) {
      const d = drops[i]
      d[1] = wrap(d[1] - RAIN_SPEED * dt, RAIN_BOX[1])
      m.makeTranslation(dropCoord(d[0], cam.x, RAIN_BOX[0]), dropCoord(d[1], cam.y, RAIN_BOX[1]), dropCoord(d[2], cam.z, RAIN_BOX[2]))
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, update }
}
