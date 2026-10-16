// Effect pad decals: a coloured pad with a white icon per effect (src/race/effects.ts). The pad
// covers the zone's physics extent (zoneCorners, the fractions the effects read the material from),
// so the driver sees exactly where an effect starts. Pure geometry plus the look table; zones.ts
// turns them into meshes.
import { zoneCorners, type EffectKind, type Pose, type Track, type Zone } from '../../track/schema'

/** Pad colour (sRGB hex) and emissive strength per effect; distinct from each other and the turbo pads. */
export const EFFECT_LOOK: Record<EffectKind, { color: number; emissive: number }> = {
  'no-steer': { color: 0xff7a00, emissive: 0.5 },
  'engine-off': { color: 0x6b7280, emissive: 0.35 },
  'cruise': { color: 0x2f80ff, emissive: 0.5 },
  'slow-mo': { color: 0x9b59ff, emissive: 0.5 },
  'fragile': { color: 0xff4fa3, emissive: 0.5 },
  'reset': { color: 0x22c55e, emissive: 0.5 },
}

/** HUD label per effect. */
export const EFFECT_LABEL: Record<EffectKind, string> = {
  'no-steer': 'NO STEER',
  'engine-off': 'ENGINE OFF',
  'cruise': 'CRUISE',
  'slow-mo': 'SLOW-MO',
  'fragile': 'FRAGILE',
  'reset': 'RESET',
}

// Icon shapes as triangles in a unit box: u across the road (0 left .. 1 right), v along it (0 entry .. 1 exit).
type UV = [number, number]
const rect = (u0: number, v0: number, u1: number, v1: number): UV[] => [[u0, v0], [u1, v0], [u0, v1], [u1, v0], [u1, v1], [u0, v1]]
const quad = (a: UV, b: UV, c: UV, d: UV): UV[] => [a, b, c, a, c, d]
const bar = (a: UV, b: UV, w: number): UV[] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const nu = (-(b[1] - a[1]) / len) * (w / 2)
  const nv = ((b[0] - a[0]) / len) * (w / 2)
  return quad([a[0] + nu, a[1] + nv], [a[0] - nu, a[1] - nv], [b[0] - nu, b[1] - nv], [b[0] + nu, b[1] + nv])
}
const ring = (cu: number, cv: number, r0: number, r1: number, n = 20): UV[] => {
  const out: UV[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    const b = (2 * Math.PI * (i + 1)) / n
    const p = (r: number, t: number): UV => [cu + r * Math.cos(t), cv + r * Math.sin(t)]
    out.push(...quad(p(r0, a), p(r1, a), p(r1, b), p(r0, b)))
  }
  return out
}

/** One icon per effect: straight arrow, cross, equals, hourglass, crack, ring. */
export const EFFECT_ICON: Record<EffectKind, UV[]> = {
  // Wheel locked straight: an arrow that only goes forward.
  'no-steer': [...rect(0.42, 0.05, 0.58, 0.6), [0.2, 0.6], [0.8, 0.6], [0.5, 0.95]],
  // Engine cut: a cross.
  'engine-off': [...bar([0.15, 0.15], [0.85, 0.85], 0.14), ...bar([0.85, 0.15], [0.15, 0.85], 0.14)],
  // Speed held: equals sign.
  'cruise': [...rect(0.15, 0.27, 0.85, 0.42), ...rect(0.15, 0.58, 0.85, 0.73)],
  // Time slowed: an hourglass.
  'slow-mo': [[0.15, 0.95], [0.85, 0.95], [0.5, 0.5], [0.15, 0.05], [0.5, 0.5], [0.85, 0.05]],
  // Fragile: a zigzag crack.
  'fragile': [...bar([0.3, 0.05], [0.62, 0.38], 0.1), ...bar([0.62, 0.38], [0.38, 0.62], 0.1), ...bar([0.38, 0.62], [0.7, 0.95], 0.1)],
  // Reset: a ring.
  'reset': ring(0.5, 0.5, 0.28, 0.42),
}

const lerp = (a: Pose, b: Pose, t: number): Pose => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
  heading: a.heading,
})

/**
 * The effect's icon on its pad as triangle positions, `lift` metres over the road. The icon box is
 * square (side `size` × pad width, shortened to the pad's length) and centred on the pad.
 */
export const effectIcon = (track: Track, zone: Zone & { kind: EffectKind }, width: number, lift: number, size = 0.6): Float32Array => {
  const [l0, r0, l1, r1] = zoneCorners(track, zone, width * size)
  const length = Math.hypot((l1.x + r1.x - l0.x - r0.x) / 2, (l1.z + r1.z - l0.z - r0.z) / 2)
  const side = Math.min(width * size, length)
  const v0 = (1 - side / length) / 2
  const v1 = 1 - v0
  const out: number[] = []
  for (const [u, v] of EFFECT_ICON[zone.kind]) {
    const t = v0 + (v1 - v0) * v
    const p = lerp(lerp(l0, r0, u), lerp(l1, r1, u), t)
    out.push(p.x, p.y + lift, p.z)
  }
  return new Float32Array(out)
}
