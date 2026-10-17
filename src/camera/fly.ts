// Free-fly camera (C toggles, `?cam=fly` opens in it): WASD / arrows move, mouse drag looks,
// E / Q rise and sink, Shift is fast, O starts a slow orbit of the whole track. Pure TypeScript.
import { add, scale, sub, v3, type Vec3 } from '../physics/vec'
import { centreline } from '../track/centreline'
import type { Track } from '../track/schema'

/** Camera pose: yaw in the `?yaw=` convention (radians here; 0 = +z, CCW positive), pitch up positive. */
export type FlyCam = { position: Vec3; velocity: Vec3; yaw: number; pitch: number }
/** Movement axes in -1..1 (forward, right, up) plus the fast modifier. */
export type FlyInput = { forward: number; right: number; up: number; fast: boolean }

export const FLY_SPEED = 20 // m/s
export const FLY_FAST = 80 // m/s with Shift
const FLY_ACCEL = 6 // 1/s — how quickly velocity follows the keys
export const MIN_HEIGHT = 0.5 // m above the ground plane (y = 0)
export const MAX_PITCH = (89 * Math.PI) / 180
export const LOOK_RAD_PER_PX = 0.004
export const FLY_FOV = 70
/** Orbit angular speed: one lap of the track per minute. */
export const ORBIT_RATE = (2 * Math.PI) / 60

const DEG = Math.PI / 180

export const flyToggleKey = (code: string): boolean => code === 'KeyC'
export const orbitToggleKey = (code: string): boolean => code === 'KeyO'

export const flyRequested = (search: string): boolean => new URLSearchParams(search).get('cam') === 'fly'
export const orbitRequested = (search: string): boolean => new URLSearchParams(search).get('orbit') === '1'

/** Held key codes → fly input. Space is left alone: it is the Begin key. */
export const flyInputFrom = (down: ReadonlySet<string>): FlyInput => {
  const any = (...codes: string[]) => codes.some((c) => down.has(c))
  return {
    forward: (any('KeyW', 'ArrowUp') ? 1 : 0) - (any('KeyS', 'ArrowDown') ? 1 : 0),
    right: (any('KeyD', 'ArrowRight') ? 1 : 0) - (any('KeyA', 'ArrowLeft') ? 1 : 0),
    up: (any('KeyE', 'PageUp') ? 1 : 0) - (any('KeyQ', 'PageDown') ? 1 : 0),
    fast: any('ShiftLeft', 'ShiftRight'),
  }
}

const clampPitch = (p: number): number => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p))

export const createFly = (position: Vec3, yaw: number, pitch = 0): FlyCam => ({
  position: v3(position.x, Math.max(MIN_HEIGHT, position.y), position.z),
  velocity: v3(),
  yaw,
  pitch: clampPitch(pitch),
})

/** A fly pose at `eye` looking at `target`, e.g. taking over from the chase camera. */
export const flyLooking = (eye: Vec3, target: Vec3): FlyCam => {
  const to = sub(target, eye)
  return createFly(eye, Math.atan2(to.x, to.z), Math.atan2(to.y, Math.hypot(to.x, to.z)))
}

/** Unit view direction for a yaw / pitch pair. */
export const lookDir = (yaw: number, pitch: number): Vec3 =>
  v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))

/** Mouse drag by (dx, dy) pixels: right turns right, down looks down. */
export const look = (cam: FlyCam, dx: number, dy: number): FlyCam => ({
  ...cam,
  yaw: cam.yaw - dx * LOOK_RAD_PER_PX,
  pitch: clampPitch(cam.pitch - dy * LOOK_RAD_PER_PX),
})

/** One frame: velocity eases toward the keys' target, position integrates, the ground plane stops it. */
export const updateFly = (cam: FlyCam, input: FlyInput, dt: number): FlyCam => {
  const speed = input.fast ? FLY_FAST : FLY_SPEED
  // Screen-right on the flat heading: yaw 0 looks +z, so right is -x.
  const right = v3(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw))
  const move = add(add(scale(lookDir(cam.yaw, cam.pitch), input.forward), scale(right, input.right)), v3(0, input.up, 0))
  const k = 1 - Math.exp(-FLY_ACCEL * dt)
  let velocity = add(cam.velocity, scale(sub(scale(move, speed), cam.velocity), k))
  let position = add(cam.position, scale(velocity, dt))
  if (position.y < MIN_HEIGHT) {
    position = v3(position.x, MIN_HEIGHT, position.z)
    if (velocity.y < 0) velocity = v3(velocity.x, 0, velocity.z)
  }
  return { ...cam, position, velocity }
}

/** What an orbit circles: the centreline's bounding-box centre, at a radius and height that keep the whole lap in view. */
export type Orbit = { centre: Vec3; radius: number; height: number }

export const orbitFor = (track: Track): Orbit => {
  const line = centreline(track, 2)
  const xs = line.map((p) => p.x)
  const zs = line.map((p) => p.z)
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const radius = (Math.max(maxX - minX, maxZ - minZ) / 2) * 1.2 + 30
  return { centre: v3((minX + maxX) / 2, 0, (minZ + maxZ) / 2), radius, height: radius * 0.5 }
}

/** Orbit pose at `angle` (radians around +y, 0 = +z side), looking at the track centre. */
export const orbitPose = (o: Orbit, angle: number): FlyCam => {
  const position = v3(o.centre.x + o.radius * Math.sin(angle), o.height, o.centre.z + o.radius * Math.cos(angle))
  const to = sub(o.centre, position)
  return { position, velocity: v3(), yaw: Math.atan2(to.x, to.z), pitch: Math.atan2(to.y, Math.hypot(to.x, to.z)) }
}

/** The orbit angle nearest to `p`, so starting an orbit swings from where the camera is. */
export const orbitAngleNear = (o: Orbit, p: Vec3): number => Math.atan2(p.x - o.centre.x, p.z - o.centre.z)

/** `?pitch=` in degrees → radians; 0 when absent or not a number. */
export const pitchParam = (search: string): number => {
  const v = new URLSearchParams(search).get('pitch')
  const n = v === null || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n * DEG : 0
}

/** Degrees wrapped to -180..180, the HUD's `yaw` convention. */
export const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180

/** Debug URL query that reopens this exact fly view (docs/development.md § Debug screenshots), frozen like the spawn URL. */
export function flyQuery(track: string, cam: FlyCam): string {
  const p = cam.position
  const q = new URLSearchParams({
    track,
    x: p.x.toFixed(1),
    y: p.y.toFixed(1),
    z: p.z.toFixed(1),
    yaw: wrapDeg(cam.yaw / DEG).toFixed(1),
    pitch: (cam.pitch / DEG).toFixed(1),
    cam: 'fly',
    freeze: '1',
  })
  return `?${q}`
}
