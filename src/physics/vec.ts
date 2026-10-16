// Minimal 3D math for the physics core — deliberately independent of three.js.

export type Vec3 = { x: number; y: number; z: number }
export type Quat = { x: number; y: number; z: number; w: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const length = (a: Vec3): number => Math.sqrt(dot(a, a))
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l > 1e-9 ? scale(a, 1 / l) : v3()
}

export const quatIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 })

export const rotate = (q: Quat, v: Vec3): Vec3 => {
  // v' = v + 2w(u×v) + 2u×(u×v), u = (q.x, q.y, q.z)
  const u = v3(q.x, q.y, q.z)
  const t = scale(cross(u, v), 2)
  return add(add(v, scale(t, q.w)), cross(u, t))
}

export const quatMul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
})

export const quatNormalize = (q: Quat): Quat => {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }
}

// Integrate orientation by angular velocity w (world frame) over dt.
export const integrateQuat = (q: Quat, w: Vec3, dt: number): Quat => {
  const dq = quatMul({ x: w.x, y: w.y, z: w.z, w: 0 }, q)
  return quatNormalize({
    x: q.x + 0.5 * dt * dq.x,
    y: q.y + 0.5 * dt * dq.y,
    z: q.z + 0.5 * dt * dq.z,
    w: q.w + 0.5 * dt * dq.w,
  })
}
