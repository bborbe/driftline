// Speed lines: thin white streaks rushing past the camera above 20 m/s, more the faster the car goes.
import * as THREE from 'three/webgpu'

export const SPEEDLINE_MIN = 20 // m/s; none at or below
export const SPEEDLINE_FULL = 50 // m/s; all lines from here
export const MAX_SPEEDLINES = 120

export const speedLineCount = (speed: number): number => {
  const s = Math.abs(speed)
  if (s <= SPEEDLINE_MIN) return 0
  return Math.max(1, Math.min(MAX_SPEEDLINES, Math.round(((s - SPEEDLINE_MIN) / (SPEEDLINE_FULL - SPEEDLINE_MIN)) * MAX_SPEEDLINES)))
}

const NEAR = 4
const FAR = 70

export type SpeedLines = { object: THREE.InstancedMesh; update: (speed: number, dt: number) => void }

/** Lines live in camera space: add `object` to the camera, and the camera to the scene. */
export const createSpeedLines = (): SpeedLines => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.03, 0.03, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
    MAX_SPEEDLINES,
  )
  mesh.frustumCulled = false
  mesh.count = 0
  // Seeded layout: a hollow tube around the view axis, so lines never cross the car.
  const lines = Array.from({ length: MAX_SPEEDLINES }, (_, i) => {
    const a = (i * 2.399963) % (Math.PI * 2) // golden angle spreads them evenly
    const r = 3 + ((i * 7919) % 50) / 10
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 + 1, z: NEAR + ((i * 104729) % (FAR - NEAR)) }
  })
  const m = new THREE.Matrix4()
  const update = (speed: number, dt: number) => {
    mesh.count = speedLineCount(speed)
    if (mesh.count === 0) return
    for (let i = 0; i < mesh.count; i++) {
      const l = lines[i]
      l.z -= Math.abs(speed) * 1.5 * dt
      if (l.z < NEAR) l.z += FAR - NEAR
      mesh.setMatrixAt(i, m.makeTranslation(l.x, l.y, -l.z)) // camera looks down -z
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  return { object: mesh, update }
}
