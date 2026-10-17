// A free-drive test pad (Track.pad): one flat asphalt slab plus its painted guides — the circles and
// the lane with its distance marks. The guide geometry is pure (padGuides, unit-tested); createPad()
// only wraps it in three.js. The walls are ordinary barriers (src/track/shapes.ts padWalls), drawn by
// createBarriers and collided with by the physics, from the one function.
import * as THREE from 'three/webgpu'
import { ASPHALT } from '../look'
import { flat } from '../tags'
import { padLaneMarks, ROAD_WIDTH, type Pad, type Track } from '../../track/schema'
import { ROAD_ROUGHNESS } from './mesh'
import { ROAD_TOP, ZONE_LIFT } from './zones'

/** Painted line width in metres: faint guides, wide enough to read from the chase camera. */
export const GUIDE_LINE = 0.35
/** Distance marks run across the lane this deep along it. */
export const MARK_DEPTH = 0.6
/** Segments per circle: a 0.35 m line on an r 80 m circle stays round to the eye. */
const CIRCLE_STEPS = 192

/** One flat quad strip (two triangles per step) at the decal height, as a triangle list of xyz. */
const quad = (out: number[], a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
  for (const [x, z] of [a, b, c, a, c, d]) out.push(x, ZONE_LIFT, z)
}

/** Ring of `radius` (line centre) about [cx, cz], GUIDE_LINE wide. */
const ring = (out: number[], [cx, cz]: [number, number], radius: number) => {
  const r0 = radius - GUIDE_LINE / 2
  const r1 = radius + GUIDE_LINE / 2
  for (let i = 0; i < CIRCLE_STEPS; i++) {
    const a0 = (i / CIRCLE_STEPS) * Math.PI * 2
    const a1 = ((i + 1) / CIRCLE_STEPS) * Math.PI * 2
    const p = (r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cz + Math.sin(a) * r]
    quad(out, p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1))
  }
}

/** Guide decals: the circles, the lane's two edge lines and a mark across it every `lane.marks` metres. */
export const padGuides = (pad: Pad): { circles: Float32Array[]; lane: Float32Array; marks: Float32Array } => {
  const circles = pad.circles.map((r) => {
    const out: number[] = []
    ring(out, pad.circleCentre, r)
    return new Float32Array(out)
  })
  const { from, to } = pad.lane
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const [fx, fz] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
  const [lx, lz] = [fz, -fx] // lateral
  const half = ROAD_WIDTH / 2
  const at = (p: [number, number], along: number, side: number): [number, number] => [p[0] + fx * along + lx * side, p[1] + fz * along + lz * side]
  const lane: number[] = []
  for (const s of [-half, half]) quad(lane, at(from, 0, s - GUIDE_LINE / 2), at(from, 0, s + GUIDE_LINE / 2), at(from, length, s + GUIDE_LINE / 2), at(from, length, s - GUIDE_LINE / 2))
  const marks: number[] = []
  for (const m of padLaneMarks(pad)) quad(marks, at(m, -MARK_DEPTH / 2, -half), at(m, -MARK_DEPTH / 2, half), at(m, MARK_DEPTH / 2, half), at(m, MARK_DEPTH / 2, -half))
  return { circles, lane: new Float32Array(lane), marks: new Float32Array(marks) }
}

const slabMaterial = new THREE.MeshPhysicalMaterial({ color: ASPHALT, roughness: ROAD_ROUGHNESS, clearcoat: 0.15, clearcoatRoughness: 0.5, metalness: 0 })
// Faint: a light grey that reads against the dark asphalt without shouting like a curb.
const guideMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false, side: THREE.DoubleSide })

const decal = (positions: Float32Array): THREE.Mesh => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // Flat on the pad: every normal is straight up, whatever the strip's winding.
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  const m = new THREE.Mesh(geo, guideMaterial)
  m.receiveShadow = true
  m.renderOrder = 1
  return flat(m, 'decal')
}

/** The pad's slab (at the road top, like every other road) and its guides; empty for a track without a pad. */
export const createPad = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'pad'
  const pad = track.pad
  if (!pad) return group
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(pad.size, pad.size), slabMaterial)
  slab.rotation.x = -Math.PI / 2
  slab.position.set(pad.centre[0], ROAD_TOP, pad.centre[1])
  slab.receiveShadow = true
  group.add(flat(slab, 'road'))
  const guides = padGuides(pad)
  for (const c of guides.circles) group.add(decal(c))
  group.add(decal(guides.lane), decal(guides.marks))
  return group
}
