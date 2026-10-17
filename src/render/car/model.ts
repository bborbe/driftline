// The player car view: builds the registry entry chosen at build time and drives its
// wheel nodes from physics state. Falls back to the box when a model fails to load.
import * as THREE from 'three/webgpu'
import { dot, forwardOf, type CarState } from '../../physics'
import { STEERED, WHEEL_NODES, type Corner } from '../../car/wheels'
import { CAR_ID, FALLBACK_CAR, resolveCar } from '../cars'
import { createBodyFeel, updateBodyFeel } from './body'
import type { Livery } from './livery'
import { applyLivery } from './paint'
import { spinRate, wheelYaw } from './rig'

export type CarView = {
  object: THREE.Object3D
  /** Pose the car and its wheels from physics state; dt in seconds. */
  update: (s: CarState, dt: number) => void
  /** Repaint the car (render/car/livery.ts); takes effect on the next frame. */
  setLivery: (l: Livery) => void
}

const view = (root: THREE.Object3D): CarView => {
  const wheels = new Map<Corner, THREE.Object3D>()
  for (const [corner, name] of Object.entries(WHEEL_NODES) as [Corner, string][]) {
    const w = root.getObjectByName(name)
    if (w) wheels.set(corner, w)
  }
  root.traverse((o) => (o.castShadow = true))
  let roll = 0
  let body = createBodyFeel()
  const lean = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const up = new THREE.Vector3()
  return {
    object: root,
    setLivery: (l) => applyLivery(root, l),
    update: (s, dt) => {
      root.position.set(s.position.x, s.position.y, s.position.z)
      root.quaternion.set(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w)
      // Body feel on top of the physics pose: lean in the car frame, squat along body up.
      body = updateBodyFeel(body, s.velocity, s.orientation, dt)
      root.quaternion.multiply(lean.setFromEuler(euler.set(body.pitch.x, 0, body.roll.x)))
      root.position.addScaledVector(up.set(0, 1, 0).applyQuaternion(root.quaternion), body.squat.x)
      roll += spinRate(dot(s.velocity, forwardOf(s))) * dt
      for (const [corner, w] of wheels) {
        w.rotation.x = roll
        w.rotation.y = STEERED.includes(corner) ? wheelYaw(s.steerAngle) : 0
      }
    },
  }
}

export const createCarView = async (id: string = CAR_ID, livery?: Livery): Promise<CarView> => {
  const entry = resolveCar(id)
  let car: CarView
  try {
    car = view(await entry.build())
  } catch (err) {
    console.warn(`car "${entry.id}" failed to load, using ${FALLBACK_CAR}: ${String(err)}`)
    car = view(await resolveCar(FALLBACK_CAR).build())
  }
  if (livery) car.setLivery(livery)
  return car
}
