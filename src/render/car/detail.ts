// Car detail added to any registry car (box, stadium, Kenney glbs): suspension wishbones from the
// body to each wheel, a driver helmet in the cockpit, and tread blocks plus a spoked hub on every
// wheel, so a spinning wheel reads as spinning. Render-only and code-built (no assets); the detail
// never enters the livery (paint.ts skips it) and adds nothing to collision. Each frame the view
// moves every wheel to its physics spring length and re-aims its arms at it (`setTravel`), and fades
// the tread and spokes out with speed before they alias into a wagon-wheel strobe (`setSpeed`).
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
// Visual travel limits on the spring length (m, mount to wheel centre): full droop at the physics
// REST_LENGTH, and a bump stop so a wheel pressed deep into a landing never climbs into the body.
const SPRING_MAX = 0.5
const SPRING_MIN = 0.2
// The frame rate the strobe limit is set for: a spoke or tread block that turns more than half its
// pitch per frame aliases (reads as standing still or turning backwards). Faster displays alias later.
const STROBE_FPS = 60

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

/** Speed (m/s) at which a wheel with `count` evenly spaced features turns half a pitch per STROBE_FPS frame. */
export const strobeLimit = (count: number): number => (Math.PI / count) * PHYSICS_WHEEL_RADIUS * STROBE_FPS

/** Opacity of a feature with strobe limit `limit` at forward speed `speed`: 1 up to half the limit, 0 at it. */
export const strobeFade = (speed: number, limit: number): number => {
  const t = Math.min(Math.max((Math.abs(speed) / limit - 0.5) / 0.5, 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

/** Wheel centre height in the car frame for a physics spring length, clamped to the visual travel. */
export const wheelCentreY = (springLength: number): number => -Math.min(Math.max(springLength, SPRING_MIN), SPRING_MAX)

/** Upper and lower wishbones of one wheel: each a V from two body points to the wheel's inner pivot. */
type Wishbones = {
  mesh: THREE.Mesh
  rest: Float32Array // vertex positions at the built pose
  vees: { from: number; to: number; base: THREE.Vector3; end: THREE.Vector3 }[] // vertex range, body end, outer end minus body end
  dy: number // the lift the vertices currently show
}

const suspension = (w: WheelShape, corner: Corner): Wishbones => {
  const parts: THREE.BufferGeometry[] = []
  const vees: Wishbones['vees'] = []
  let from = 0
  for (const rise of [ARM_RISE, -ARM_RISE]) {
    const base = new THREE.Vector3(w.side * ARM_INNER_X, w.centre.y + rise, w.centre.z)
    const end = new THREE.Vector3(w.inner, w.centre.y + rise * 0.8, w.centre.z)
    let count = 0
    for (const along of [ARM_SPREAD, -ARM_SPREAD]) {
      const indexed = rod(base.clone().setZ(w.centre.z + along), end, ARM_RADIUS)
      const g = indexed.toNonIndexed()
      indexed.dispose()
      count += g.getAttribute('position').count
      parts.push(g)
    }
    vees.push({ from, to: from + count, base, end: end.sub(base) })
    from += count
  }
  const mesh = mark(merged(parts, carbon), `suspension-${corner}`)
  return { mesh, rest: Float32Array.from(mesh.geometry.getAttribute('position').array), vees, dy: 0 }
}

/**
 * Re-aim both wishbones at the wheel pivot moved `dy` up the car frame. Each V lies in a plane holding
 * the car's z axis, so a rotation about z plus an in-plane scale round its body end lands its outer end
 * exactly on the moved pivot. One mesh per wheel, rewritten only when the lift changes.
 */
const aimArms = (arms: Wishbones, dy: number): void => {
  if (Math.abs(dy - arms.dy) < 1e-4) return
  arms.dy = dy
  const pos = arms.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const out = pos.array as Float32Array
  for (const v of arms.vees) {
    const turn = Math.atan2(v.end.y + dy, v.end.x) - Math.atan2(v.end.y, v.end.x)
    const s = Math.hypot(v.end.x, v.end.y + dy) / Math.hypot(v.end.x, v.end.y)
    const c = Math.cos(turn) * s
    const n = Math.sin(turn) * s
    for (let i = v.from * 3; i < v.to * 3; i += 3) {
      const x = arms.rest[i] - v.base.x
      const y = arms.rest[i + 1] - v.base.y
      out[i] = v.base.x + c * x - n * y
      out[i + 1] = v.base.y + n * x + c * y
    }
  }
  pos.needsUpdate = true
  arms.mesh.geometry.computeBoundingSphere()
}

/** A wheel's travel handle: the node, its built centre, and how a car-frame lift maps into its parent. */
type Travel = { node: THREE.Object3D; rest: THREE.Vector3; up: THREE.Vector3; centreY: number; x: number; z: number; arms: Wishbones }

export type DetailRig = {
  /**
   * Move each wheel to its spring length (m, mount to wheel centre along body-down) and re-aim its
   * arms. `springs` lists physics mounts in the car frame; each wheel takes the mount on its side and
   * end. Without springs every wheel returns to its built pose.
   */
  setTravel: (springs?: readonly { mount: { x: number; z: number }; length: number }[]) => void
  /** Fade the tread and spokes for forward speed `speed` (m/s); returns the [tread, spoke] opacity. */
  setSpeed: (speed: number) => [number, number]
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
export const attachDetail = (root: THREE.Object3D, cockpit?: readonly [number, number, number]): DetailRig => {
  root.updateMatrixWorld(true)
  const group = mark(new THREE.Group(), 'detail')
  let at: THREE.Vector3
  if (cockpit) at = new THREE.Vector3(...cockpit)
  else {
    const box = new THREE.Box3().setFromObject(root)
    at = new THREE.Vector3(0, box.max.y + HELMET_RADIUS * 0.4, (box.min.z + box.max.z) / 2)
  }
  const travels: Travel[] = []
  const treads: THREE.Mesh[] = []
  const hubs: THREE.Mesh[] = []
  for (const [corner, name] of Object.entries(WHEEL_NODES) as [Corner, string][]) {
    const wheel = root.getObjectByName(name)
    if (!wheel) continue
    const shape = wheelShape(wheel, root)
    const { tread, hub } = wheelDetail(shape)
    // Per-car material copies: the fade writes opacity, and two cars (player, ghost) fade apart.
    for (const m of [tread, hub]) m.material = (m.material as THREE.Material).clone()
    treads.push(tread)
    hubs.push(hub)
    // Built in the car frame; re-expressed in the wheel node's frame so it spins and steers with it.
    const toWheel = wheel.matrixWorld.clone().invert().multiply(root.matrixWorld)
    for (const [m, label] of [
      [tread, 'tread'],
      [hub, 'hub'],
    ] as const) {
      m.geometry.applyMatrix4(toWheel)
      wheel.add(mark(m, `${label}-${corner}`))
    }
    const arms = suspension(shape, corner)
    group.add(arms.mesh)
    // The model may be scaled and offset: lift the wheel node in its parent's frame.
    const parentToCar = root.matrixWorld.clone().invert().multiply(wheel.parent!.matrixWorld)
    travels.push({ node: wheel, rest: wheel.position.clone(), up: carLiftInParent(parentToCar), centreY: shape.centre.y, x: shape.centre.x, z: shape.centre.z, arms })
  }
  group.add(helmet(at))
  root.add(group)
  const treadLimit = strobeLimit(TREAD_BLOCKS)
  const spokeLimit = strobeLimit(SPOKES)
  const fade = (meshes: THREE.Mesh[], f: number): void => {
    for (const m of meshes) {
      const mat = m.material as THREE.Material
      mat.userData.base ??= mat.opacity // the ghost lowers the base after the view is built
      mat.userData.blend ??= mat.transparent
      mat.opacity = mat.userData.base * f
      // Blend only while fading (or on the ghost): opaque tread and hubs stay out of the transparent pass.
      const blend = mat.userData.blend || (f > 0 && f < 1)
      if (mat.transparent !== blend) {
        mat.transparent = blend
        mat.needsUpdate = true
      }
      m.visible = f > 0
    }
  }
  return {
    setTravel: (springs) => {
      for (const t of travels) {
        const spring = springs?.find((s) => Math.sign(s.mount.x) === Math.sign(t.x) && Math.sign(s.mount.z) === Math.sign(t.z))
        const dy = spring ? wheelCentreY(spring.length) - t.centreY : 0
        t.node.position.copy(t.rest).addScaledVector(t.up, dy)
        aimArms(t.arms, dy)
      }
    },
    setSpeed: (speed) => {
      const f: [number, number] = [strobeFade(speed, treadLimit), strobeFade(speed, spokeLimit)]
      fade(treads, f[0])
      fade(hubs, f[1])
      return f
    },
  }
}

/** The parent-frame vector that moves a child one metre up the car frame (`parentToCar` maps parent → car). */
const carLiftInParent = (parentToCar: THREE.Matrix4): THREE.Vector3 => {
  const o = new THREE.Vector3().applyMatrix4(parentToCar.clone().invert())
  return new THREE.Vector3(0, 1, 0).applyMatrix4(parentToCar.clone().invert()).sub(o)
}
