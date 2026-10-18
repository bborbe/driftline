// Live 3D start menu (operator's pick, 2026-10-18): the menu panel sits on the left over the running scene, the car
// stands on the start grid in the current livery and the camera circles it slowly on the right of the screen. Only the
// renderer runs — no physics tick, ghost, audio or race HUD — so the race that follows starts exactly as before.
// `menuCamera` is pure and tested; `runMenuScene` owns the animation loop until the pick.
import { createCarAt } from '../physics'
import { add, v3, type Vec3 } from '../physics/vec'
import type { View } from '../render/view'
import type { Track } from '../track/schema'
import { FrameGate } from '../render/frame-cap'

/** Orbit speed, rad/s (~6°/s): slow enough to read as a showroom turntable, not a replay camera. */
export const MENU_ORBIT_RATE = 0.105
const RADIUS = 6.2
const HEIGHT = 1.9
const LOOK_HEIGHT = 0.7
/** Fraction of the screen width the image shifts right, so the car stands clear of the left-hand panels. */
export const MENU_SHIFT = 0.33

/** Camera eye and look-at point `t` s into the menu, circling `car` from a three-quarter front view. */
export function menuCamera(t: number, car: Vec3, heading: number): { eye: Vec3; target: Vec3 } {
  const a = heading + Math.PI * 0.25 + MENU_ORBIT_RATE * t
  return { eye: add(car, v3(RADIUS * Math.sin(a), HEIGHT, RADIUS * Math.cos(a))), target: add(car, v3(0, LOOK_HEIGHT, 0)) }
}

/** Starts the menu loop on `view`, rendering at most `fps()` frames a second (0: every frame; render/frame-cap.ts); the
 * returned function stops it and hands the renderer back. */
export function runMenuScene(view: View, track: Track, fps: () => number = () => 0): () => void {
  const car = createCarAt(track.start)
  const { camera, renderer } = view
  const shift = () => {
    const w = renderer.domElement.clientWidth || innerWidth
    const h = renderer.domElement.clientHeight || innerHeight
    camera.setViewOffset(w, h, -w * MENU_SHIFT, 0, w, h)
  }
  shift()
  addEventListener('resize', shift)
  let t = 0
  let last = performance.now()
  const gate = new FrameGate()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    if (!gate.due(now, fps(), document.hidden)) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    t += dt
    const { eye, target } = menuCamera(t, car.position, track.start.heading)
    camera.position.set(eye.x, eye.y, eye.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(target.x, target.y, target.z)
    view.frame(car, dt)
  })
  return () => {
    renderer.setAnimationLoop(null)
    removeEventListener('resize', shift)
    camera.clearViewOffset()
  }
}
