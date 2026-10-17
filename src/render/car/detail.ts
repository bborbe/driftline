// Car detail added to any registry car (box, stadium, Kenney glbs): suspension wishbones from the
// body to each wheel, a driver helmet in the cockpit, and tread blocks plus a spoked hub on every
// wheel, so a spinning wheel reads as spinning. Render-only and code-built (no assets); the detail
// never enters the livery (paint.ts skips it) and adds nothing to collision. The arms hold the
// wheel's rest pose: the view never moves a wheel vertically, so there is no travel to follow.
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WHEEL_NODES, type Corner } from '../../car/wheels'
import { PHYSICS_WHEEL_RADIUS } from './rig'

/** userData flag on every detail object; paint.ts leaves anything under it unpainted. */
export const DETAIL_FLAG = 'carDetail'

/** True when `o` or an ancestor is car detail. */
export const isDetail = (o: THREE.Object3D): boolean => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData[DETAIL_FLAG]) return true
  return false
}

const TREAD_BLOCKS = 20
const SPOKES = 5
const ARM_RADIUS = 0.022 // m
const ARM_SPREAD = 0.46 // m: half the wishbone's base along the car, at the body end; wider than the tyre, so the arms show from the side
const ARM_INNER_X = 0.2 // m: where the wishbones meet the body, off the car's centre line
const ARM_RISE = 0.09 // m: upper and lower wishbone height off the hub centre
const HELMET_RADIUS = 0.17 // m

// Plain (non-physical, unmapped) materials: the livery painter treats them as unpainted.
const carbon = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.3, name: 'detail-carbon' })
const rubber = new THREE.MeshStandardMaterial({ color: 0x2b2c31, roughness: 0.95, name: 'detail-tread' })
const alloy = new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.3, metalness: 0.8, name: 'detail-hub' })
const shell = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35, name: 'detail-helmet' })
const visor = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.1, metalness: 0.6, name: 'detail-visor' })

const mark = <T extends THREE.Object3D>(o: T, name: string): T => {
  o.name = name
  o.userData[DETAIL_FLAG] = true
  return o
}

/** A rod of radius `r` from `a` to `b`. */
const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry => {
  const dir = new THREE.Vector3().subVectors(b, a)
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 6)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return g
}

/** One mesh from geometries that share a material: one draw call per part. */
const merged = (parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh => {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const g = mergeGeometries(flat)
  for (const p of new Set([...parts, ...flat])) p.dispose()
  if (!g) throw new Error(`car detail: cannot merge ${parts.length} parts for ${material.name}`)
  return new THREE.Mesh(g, material)
}

/** A wheel's shape in the car frame, from its own meshes (not the rim glow lights.ts adds). */
type WheelShape = { centre: THREE.Vector3; radius: number; inner: number; outer: number; side: number }

const wheelShape = (wheel: THREE.Object3D, root: THREE.Object3D): WheelShape => {
  const inv = root.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  const part = new THREE.Box3()
  wheel.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || o.name === 'rim-glow' || isDetail(o)) return
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    box.union(part.copy(m.geometry.boundingBox!).applyMatrix4(inv.clone().multiply(m.matrixWorld)))
  })
  if (box.isEmpty()) {
    const c = new THREE.Vector3().setFromMatrixPosition(wheel.matrixWorld).applyMatrix4(inv)
    box.setFromCenterAndSize(c, new THREE.Vector3(0.3, 2 * PHYSICS_WHEEL_RADIUS, 2 * PHYSICS_WHEEL_RADIUS))
  }
  const centre = box.getCenter(new THREE.Vector3())
  const side = Math.sign(centre.x) || 1
  return {
    centre,
    radius: (box.max.y - box.min.y) / 2,
    inner: side > 0 ? box.min.x : box.max.x,
    outer: side > 0 ? box.max.x : box.min.x,
    side,
  }
}

/** Tread blocks round the tyre and a spoked hub on its outer face, built in the car frame. */
const wheelDetail = (w: WheelShape): { tread: THREE.Mesh; hub: THREE.Mesh } => {
  const width = Math.abs(w.outer - w.inner)
  const blocks: THREE.BufferGeometry[] = []
  for (let i = 0; i < TREAD_BLOCKS; i++) {
    // Tops 3 mm proud of the tyre radius: ribs on a low-poly tyre's flats, still visible on a smooth one.
    const g = new THREE.BoxGeometry(width * 0.86, 0.03, 0.05)
    g.translate(0, w.radius - 0.012, 0)
    g.rotateX((i / TREAD_BLOCKS) * Math.PI * 2)
    g.translate(w.centre.x, w.centre.y, w.centre.z)
    blocks.push(g)
  }
  const face = w.outer + w.side * 0.012 // just proud of the outer face
  const spokes: THREE.BufferGeometry[] = []
  for (let i = 0; i < SPOKES; i++) {
    const g = new THREE.BoxGeometry(0.024, w.radius * 0.42, 0.05)
    g.translate(0, w.radius * 0.24, 0)
    g.rotateX((i / SPOKES) * Math.PI * 2)
    g.translate(face, w.centre.y, w.centre.z)
    spokes.push(g)
  }
  const nut = new THREE.CylinderGeometry(w.radius * 0.13, w.radius * 0.13, 0.04, 6)
  nut.rotateZ(Math.PI / 2)
  nut.translate(face, w.centre.y, w.centre.z)
  spokes.push(nut)
  return { tread: merged(blocks, rubber), hub: merged(spokes, alloy) }
}

/** Upper and lower wishbones, each a V from two body points to the wheel's inner pivot. */
const suspension = (w: WheelShape): THREE.Mesh => {
  const parts: THREE.BufferGeometry[] = []
  for (const rise of [ARM_RISE, -ARM_RISE]) {
    const end = new THREE.Vector3(w.inner, w.centre.y + rise * 0.8, w.centre.z)
    for (const along of [ARM_SPREAD, -ARM_SPREAD]) {
      parts.push(rod(new THREE.Vector3(w.side * ARM_INNER_X, w.centre.y + rise, w.centre.z + along), end, ARM_RADIUS))
    }
  }
  return merged(parts, carbon)
}

/** A white helmet centred on `at`, with a dark visor band facing the nose (+z). */
const helmet = (at: THREE.Vector3): THREE.Mesh => {
  const head = mark(new THREE.Mesh(new THREE.SphereGeometry(HELMET_RADIUS, 14, 10), shell), 'helmet')
  head.position.copy(at)
  head.scale.set(1, 1, 1.1)
  // A slice of a slightly larger sphere round the front: three.js puts phi = π/2 on +z.
  const band = new THREE.SphereGeometry(HELMET_RADIUS * 1.04, 14, 4, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.34, Math.PI * 0.2)
  head.add(mark(new THREE.Mesh(band, visor), 'helmet-visor'))
  return head
}

/**
 * Add the detail to the car under `root` (car frame, unposed, as the registry builds it). Tread and
 * hub go under each wheel node, so they spin and steer with it; arms and helmet stay on the body.
 * `cockpit` is the helmet centre in the car frame; without one the helmet sits on the body's top.
 */
export const attachDetail = (root: THREE.Object3D, cockpit?: readonly [number, number, number]): void => {
  root.updateMatrixWorld(true)
  const group = mark(new THREE.Group(), 'detail')
  let at: THREE.Vector3
  if (cockpit) at = new THREE.Vector3(...cockpit)
  else {
    const box = new THREE.Box3().setFromObject(root)
    at = new THREE.Vector3(0, box.max.y + HELMET_RADIUS * 0.4, (box.min.z + box.max.z) / 2)
  }
  for (const [corner, name] of Object.entries(WHEEL_NODES) as [Corner, string][]) {
    const wheel = root.getObjectByName(name)
    if (!wheel) continue
    const shape = wheelShape(wheel, root)
    const { tread, hub } = wheelDetail(shape)
    // Built in the car frame; re-expressed in the wheel node's frame so it spins and steers with it.
    const toWheel = wheel.matrixWorld.clone().invert().multiply(root.matrixWorld)
    for (const [m, label] of [
      [tread, 'tread'],
      [hub, 'hub'],
    ] as const) {
      m.geometry.applyMatrix4(toWheel)
      wheel.add(mark(m, `${label}-${corner}`))
    }
    group.add(mark(suspension(shape), `suspension-${corner}`))
  }
  group.add(helmet(at))
  root.add(group)
}
