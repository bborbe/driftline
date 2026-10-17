// Camera wiring for main.ts: view keys 1/2/3, the free-fly camera (C, ?cam=fly), track orbit (O) and mouse look.
// The math lives in chase.ts, feel.ts, fly.ts and views.ts; this module owns the mode state and drives the three.js camera.
import type { PerspectiveCamera } from 'three'
import { forwardOf, type CarState } from '../physics'
import { add, cross, normalize, rotate, scale, v3, type Vec3 } from '../physics/vec'
import type { Pose, Track } from '../track/schema'
import { loopTubes } from '../track/pose'
import { cockpitPose, COCKPIT_FOV, createChase, FAR_RIG, CLOSE_RIG, updateChase } from './chase'
import { CAMERA_EVENT, loadView, saveView, viewForKey, type ViewMode } from './views'
import {
  CAMERA_FX_EVENT,
  damp,
  finishOrbitPosition,
  fovFor,
  FOV_REST,
  fxScale,
  impactOf,
  leanFor,
  loadCameraFx,
  lookAheadFor,
  NO_SHAKE,
  shakeOffset,
  signedSlipDeg,
  sweepPosition,
  sweepProgress,
  updateShake,
  type CameraFx,
  type Shake,
} from './feel'
import {
  createFly,
  flyInputFrom,
  flyLooking,
  flyRequested,
  flyToggleKey,
  isFlyKey,
  FLY_FOV,
  look,
  lookDir,
  ORBIT_RATE,
  orbitAngleNear,
  orbitFor,
  orbitPose,
  orbitRequested,
  orbitToggleKey,
  startsLook,
  pitchParam,
  updateFly,
  type FlyCam,
} from './fly'

export type CameraKey = 'view' | 'fly' | 'orbit'

/** What a keydown does to the camera, or null when it is not a camera key (or a repeat, or typed into a field). */
export function cameraKey(code: string, repeat: boolean, inField: boolean): CameraKey | null {
  if (repeat || inField) return null
  if (viewForKey(code)) return 'view'
  if (flyToggleKey(code)) return 'fly'
  if (orbitToggleKey(code)) return 'orbit'
  return null
}

export interface CameraOptions {
  camera: PerspectiveCamera
  canvas: HTMLElement
  track: Track
  /** The car's latest tick state (chase rig resets start from it). */
  car: () => CarState
  /** Called when fly mode starts (true) or ends (false); the caller holds race, ghost and audio still while flying. */
  onFly: (flying: boolean) => void
  /** Debug-spawn pose; with ?cam=fly it places the fly camera instead of the car. */
  pose: Pose | null
  search: string
  store: Storage
  /** Race phase and countdown (seconds left of `countdownTotal`), for the start sweep and the finish orbit. */
  race?: () => { phase: 'ready' | 'countdown' | 'racing' | 'finished'; countdownLeft: number; countdownTotal: number }
}

export interface CameraController {
  /** The free-fly camera while flying, else null. */
  readonly fly: FlyCam | null
  readonly orbiting: boolean
  readonly viewMode: ViewMode
  onKeyDown(e: KeyboardEvent): void
  /** Place the camera for this frame. `s` is the interpolated car, `held` the keys down now. */
  frame(s: CarState, speed: number, elapsed: number, held: ReadonlySet<string>): void
}

export function createCameraController(o: CameraOptions): CameraController {
  const { camera, track } = o
  // Camera views: 1 close chase, 2 far chase, 3 in-car; the choice survives reloads.
  let viewMode = loadView(o.store)
  const rigFor = () => (viewMode === 'far' ? FAR_RIG : CLOSE_RIG)
  const resetChase = () => {
    const s = o.car()
    return createChase(s.position, forwardOf(s), rigFor())
  }
  let chase = resetChase()
  const setView = (mode: ViewMode) => {
    viewMode = mode
    chase = resetChase()
  }
  window.addEventListener(CAMERA_EVENT, (e) => setView((e as CustomEvent<ViewMode>).detail))

  // Camera feel (feel.ts), scaled by Settings → Graphics → Camera effects: speed FOV, drift lean, look-ahead,
  // impact shake, the start sweep over the countdown and the finish orbit.
  let fxK = fxScale(loadCameraFx(o.store))
  window.addEventListener(CAMERA_FX_EVENT, (e) => (fxK = fxScale((e as CustomEvent<CameraFx>).detail)))
  let roll = 0 // degrees
  let lookSide = 0 // metres toward the car's left
  let shake: Shake = NO_SHAKE
  let clock = 0
  let prev: { velocity: Vec3; position: Vec3 } | null = null
  let finish: { from: Vec3; t: number } | null = null

  // Free-fly camera (C, or ?cam=fly): C again (or 1/2/3) returns to the chase/in-car view. O orbits the whole track.
  let fly: FlyCam | null = null
  let orbitAngle: number | null = null
  const orbit = orbitFor(track)
  const inLoop = loopTubes(track)
  const enterFly = (cam: FlyCam) => {
    fly = cam
    o.onFly(true)
  }
  const leaveFly = () => {
    if (!fly) return
    fly = null
    orbitAngle = null
    o.onFly(false)
    chase = resetChase()
  }
  const flyFromCamera = (): FlyCam => {
    const dir = camera.getWorldDirection(camera.position.clone())
    const eye = v3(camera.position.x, camera.position.y, camera.position.z)
    return flyLooking(eye, add(eye, v3(dir.x, dir.y, dir.z)))
  }
  const toggleOrbit = () => {
    if (orbitAngle !== null) {
      orbitAngle = null
      return
    }
    if (!fly) enterFly(flyFromCamera())
    orbitAngle = orbitAngleNear(orbit, fly!.position)
  }
  if (flyRequested(o.search)) {
    const pose = o.pose
    const car: Vec3 = o.car().position
    enterFly(
      pose
        ? createFly(v3(pose.x, pose.y, pose.z), pose.heading, pitchParam(o.search))
        : flyLooking(chase.position, v3(car.x, car.y + 0.8, car.z)),
    )
    if (orbitRequested(o.search)) toggleOrbit()
  }

  // Mouse drag looks around while flying (and ends an orbit where it is).
  let dragging = false
  o.canvas.addEventListener('mousedown', (e) => {
    if (fly && startsLook(e.button, e.ctrlKey)) dragging = true
  })
  // macOS turns Ctrl+click into a right-click; while flying Ctrl is "down", so no context menu.
  o.canvas.addEventListener('contextmenu', (e) => {
    if (fly) e.preventDefault()
  })
  window.addEventListener('mouseup', () => (dragging = false))
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !fly) return
    orbitAngle = null
    fly = look(fly, e.movementX, e.movementY)
  })

  const place = (eye: Vec3, up: Vec3, fov: number, at: Vec3) => {
    camera.position.set(eye.x, eye.y, eye.z)
    camera.up.set(up.x, up.y, up.z)
    camera.fov = fov
    camera.updateProjectionMatrix()
    camera.lookAt(at.x, at.y, at.z)
  }
  const UP = v3(0, 1, 0)

  return {
    get fly() {
      return fly
    },
    get orbiting() {
      return orbitAngle !== null
    },
    get viewMode() {
      return viewMode
    },
    onKeyDown(e) {
      if (fly && isFlyKey(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault()
      switch (cameraKey(e.code, e.repeat, e.target instanceof HTMLInputElement)) {
        case 'view': {
          const mode = viewForKey(e.code)!
          saveView(o.store, mode)
          setView(mode)
          leaveFly()
          break
        }
        case 'fly':
          if (fly) leaveFly()
          else enterFly(flyFromCamera())
          break
        case 'orbit':
          toggleOrbit()
          break
      }
    },
    frame(s, speed, elapsed, held) {
      if (fly) {
        const flyInput = flyInputFrom(held)
        if (orbitAngle !== null && (flyInput.forward || flyInput.right || flyInput.up)) orbitAngle = null
        if (orbitAngle !== null) {
          orbitAngle += ORBIT_RATE * elapsed
          fly = orbitPose(orbit, orbitAngle)
        } else fly = updateFly(fly, flyInput, Math.min(elapsed, 0.1))
        const p = fly.position
        const d = lookDir(fly.yaw, fly.pitch)
        place(p, UP, FLY_FOV, v3(p.x + d.x, p.y + d.y, p.z + d.z))
        prev = null
      } else if (viewMode === 'cockpit') {
        prev = null
        const c = cockpitPose(s.position, s.orientation)
        place(c.eye, c.up, COCKPIT_FOV, c.look)
      } else {
        const fwd = forwardOf(s)
        const carUp = inLoop(s.position) ? rotate(s.orientation, UP) : undefined
        chase = updateChase(chase, s.position, fwd, Math.abs(speed), elapsed, rigFor(), carUp)
        const dt = Math.min(elapsed, 0.1)
        clock += dt
        const k = fxK
        roll = damp(roll, carUp ? 0 : leanFor(signedSlipDeg(fwd, s.velocity), k), 4, dt)
        lookSide = damp(lookSide, carUp ? 0 : lookAheadFor(s.angularVelocity.y, speed, k), 3, dt)
        const impact = prev && dt > 0 ? impactOf(prev.velocity, s.velocity, prev.position, s.position, dt) : 0
        shake = updateShake(shake, impact, k, dt)
        prev = { velocity: s.velocity, position: s.position }

        const r = o.race?.()
        let eye = chase.position
        let fov = carUp ? chase.fov : fovFor(speed, k)
        if (r?.phase === 'countdown' && k > 0) {
          eye = sweepPosition(sweepProgress(r.countdownLeft, r.countdownTotal), s.position, fwd, chase.position)
          fov = FOV_REST
        }
        if (r?.phase === 'finished' && k > 0) {
          finish = finish ? { ...finish, t: finish.t + dt } : { from: chase.position, t: 0 }
          eye = finishOrbitPosition(finish.t, s.position, finish.from)
          fov = FOV_REST
        } else finish = null
        eye = add(eye, shakeOffset(shake, clock))

        const u = chase.up
        const left = normalize(cross(UP, v3(fwd.x, 0, fwd.z)))
        const lean = (roll * Math.PI) / 180
        const up = carUp ? u : normalize(add(scale(UP, Math.cos(lean)), scale(left, Math.sin(lean))))
        const at = add(v3(s.position.x + 0.8 * u.x, s.position.y + 0.8 * u.y, s.position.z + 0.8 * u.z), finish ? v3() : scale(left, lookSide))
        place(eye, up, fov, at)
      }
    },
  }
}
