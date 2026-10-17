// Scene geometry lint: walks a built scene graph and reports paper-thin parts and structural parts
// floating with nothing under them. One generic check for the whole class, instead of one test per
// piece (gate legs, ramp walls, footings). Driven over every shipped track by geometry-lint.test.ts.
//
// A "part" is one connected piece of a mesh: the mesh's triangles, welded at 1 mm in world space and
// split into connected components (a merged decor mesh holds hundreds of boards and posts), or one
// instance of an InstancedMesh. Tags (tags.ts) sit on the mesh or any ancestor, set at creation.
import * as THREE from 'three/webgpu'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { FLAT_REASONS, STRUCTURAL_KINDS, type FlatReason, type StructuralKind } from './tags'

/** A part thinner than this in every direction is paper-thin, unless tagged `flat`. */
export const MIN_THICKNESS = 0.15
/** A structural part touches the ground or a support when its foot is within this distance of it. */
export const CONTACT_TOLERANCE = 0.05
/** Structural kinds that must carry themselves down: their own foot touches the ground or a surface below. */
const LOAD_BEARING: readonly StructuralKind[] = ['wall', 'pillar', 'gate-leg']

export type Offender = { check: 'thin' | 'floating' | 'tag'; mesh: string; detail: string }

export type LintResult = {
  /** Every Mesh / InstancedMesh visited. */
  meshes: number
  /** Meshes carrying a structural `kind`. */
  structural: number
  /** Meshes tagged `flat`, per reason. */
  flatByReason: Partial<Record<FlatReason, number>>
  offenders: Offender[]
}

type Part = {
  mesh: THREE.Mesh
  name: string
  /** World-space vertex positions (welded), xyz. */
  positions: number[]
  /** Triangles as indices into `positions`. */
  tris: number[]
  /** One instance of an InstancedMesh. */
  instance?: number
  box: THREE.Box3
}

const fmt = (n: number) => n.toFixed(2)

/** Nearest `key` tag on the object or an ancestor. */
const tagOf = (o: THREE.Object3D, key: 'flat' | 'kind'): unknown => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData[key] !== undefined) return p.userData[key]
  return undefined
}

/** Readable path for an offender: ancestor names plus the mesh's own name or geometry/material. */
const nameOf = (mesh: THREE.Mesh): string => {
  const names: string[] = []
  for (let p: THREE.Object3D | null = mesh.parent; p; p = p.parent) if (p.name) names.unshift(p.name)
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const own = mesh.name || `${mesh.geometry.type}${mat?.name ? `[${mat.name}]` : ''}`
  return [...names, own].join('/')
}

/** Vertices closer than 1 mm are one vertex. */
const weldKey = (v: THREE.Vector3) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`

/** Watertight: every (welded) edge is shared by an even number of triangles, so the part encloses a volume. */
export const closed = (tris: number[]): boolean => {
  const edges = new Map<string, number>()
  for (let t = 0; t + 2 < tris.length; t += 3) {
    for (const [a, b] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) {
      if (a === b) continue
      const key = a < b ? `${a},${b}` : `${b},${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  return edges.size > 0 && [...edges.values()].every((n) => n % 2 === 0)
}

const triangles = (geo: THREE.BufferGeometry): number[] => {
  const n = geo.attributes.position.count
  if (geo.index) return Array.from(geo.index.array)
  return Array.from({ length: n }, (_, i) => i)
}

/** Split a Mesh into welded connected components in world space. */
const meshParts = (mesh: THREE.Mesh, name: string): Part[] => {
  const pos = mesh.geometry.attributes.position
  const tri = triangles(mesh.geometry)
  const v = new THREE.Vector3()
  const ids = new Map<string, number>()
  const world: number[] = []
  const weld: number[] = []
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    const key = weldKey(v)
    let id = ids.get(key)
    if (id === undefined) {
      id = world.length / 3
      ids.set(key, id)
      world.push(v.x, v.y, v.z)
    }
    weld.push(id)
  }
  const parent = Array.from({ length: world.length / 3 }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const a = find(weld[tri[t]])
    parent[find(weld[tri[t + 1]])] = a
    parent[find(weld[tri[t + 2]])] = a
  }
  // Each part keeps its own compact vertex list.
  const byRoot = new Map<number, Part & { local: Map<number, number> }>()
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const root = find(weld[tri[t]])
    let part = byRoot.get(root)
    if (!part) {
      part = { mesh, name, positions: [], tris: [], box: new THREE.Box3(), local: new Map() }
      byRoot.set(root, part)
    }
    for (let k = 0; k < 3; k++) {
      const w = weld[tri[t + k]]
      let l = part.local.get(w)
      if (l === undefined) {
        l = part.positions.length / 3
        part.local.set(w, l)
        part.positions.push(world[w * 3], world[w * 3 + 1], world[w * 3 + 2])
        part.box.expandByPoint(v.set(world[w * 3], world[w * 3 + 1], world[w * 3 + 2]))
      }
      part.tris.push(l)
    }
  }
  return [...byRoot.values()].map(({ local: _, ...part }) => part)
}

/** A flat mesh as one surface, unwelded: it is never judged, only stood on. */
const surfacePart = (mesh: THREE.Mesh, name: string): Part => {
  const pos = mesh.geometry.attributes.position
  const v = new THREE.Vector3()
  const positions: number[] = []
  const box = new THREE.Box3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    positions.push(v.x, v.y, v.z)
    box.expandByPoint(v)
  }
  return { mesh, name, positions, tris: triangles(mesh.geometry), box }
}

/**
 * Whether a vertical ray down from the foot point (x, y, z) meets a triangle of `part` within
 * CONTACT_TOLERANCE above or below it. Upright faces have no footprint and never carry anything.
 */
const carries = (part: Part, x: number, y: number, z: number): boolean => {
  const b = part.box
  if (x < b.min.x - 1e-4 || x > b.max.x + 1e-4 || z < b.min.z - 1e-4 || z > b.max.z + 1e-4) return false
  if (b.min.y > y + CONTACT_TOLERANCE || b.max.y < y - CONTACT_TOLERANCE) return false
  const p = part.positions
  for (let t = 0; t + 2 < part.tris.length; t += 3) {
    const a = part.tris[t] * 3
    const c1 = part.tris[t + 1] * 3
    const c2 = part.tris[t + 2] * 3
    const x0 = p[a], z0 = p[a + 2]
    const ux = p[c1] - x0, uz = p[c1 + 2] - z0
    const vx = p[c2] - x0, vz = p[c2 + 2] - z0
    const det = ux * vz - uz * vx
    if (Math.abs(det) < 1e-9) continue
    const wx = x - x0, wz = z - z0
    const s = (wx * vz - wz * vx) / det
    const r = (ux * wz - uz * wx) / det
    if (s < -1e-4 || r < -1e-4 || s + r > 1 + 1e-4) continue
    const h = p[a + 1] + s * (p[c1 + 1] - p[a + 1]) + r * (p[c2 + 1] - p[a + 1])
    if (Math.abs(h - y) <= CONTACT_TOLERANCE) return true
  }
  return false
}

/** One part per instance of an InstancedMesh. */
const instanceParts = (mesh: THREE.InstancedMesh, name: string): Part[] => {
  const pos = mesh.geometry.attributes.position
  const tri = triangles(mesh.geometry)
  const m = new THREE.Matrix4()
  const v = new THREE.Vector3()
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m)
    m.premultiply(mesh.matrixWorld)
    const ids = new Map<string, number>()
    const positions: number[] = []
    const weld: number[] = []
    const box = new THREE.Box3()
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m)
      const key = weldKey(v)
      let id = ids.get(key)
      if (id === undefined) {
        id = positions.length / 3
        ids.set(key, id)
        positions.push(v.x, v.y, v.z)
      }
      weld.push(id)
      box.expandByPoint(v)
    }
    return { mesh, name: `${name}#${i}`, positions, tris: tri.map((t) => weld[t]), instance: i, box }
  })
}

/**
 * Smallest width of a part: the spread of its vertices along each face normal of their convex hull
 * (where a solid's minimum width lies), plus the world axes. A flat sheet has no hull with volume and
 * measures ~0 along its own normal however it is turned; a closed box measures its true thickness.
 */
export const thickness = (positions: number[], tris: number[]): number => {
  const used = [...new Set(tris)]
  const points = used.map((i) => new THREE.Vector3().fromArray(positions, i * 3))
  const dirs: THREE.Vector3[] = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
  let extreme = points
  const hull = points.length >= 4 ? new ConvexHull().setFromPoints(points) : null
  if (hull && hull.faces.length >= 4) {
    extreme = hull.vertices.map((v) => v.point)
    for (const f of hull.faces) dirs.push(f.normal)
  } else {
    // Coplanar (a sheet): its own triangles' normal measures it.
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    for (let t = 0; t + 2 < tris.length; t += 3) {
      a.fromArray(positions, tris[t] * 3)
      b.fromArray(positions, tris[t + 1] * 3).sub(a)
      c.fromArray(positions, tris[t + 2] * 3).sub(a)
      const n = new THREE.Vector3().crossVectors(b, c)
      if (n.lengthSq() > 1e-12) {
        dirs.push(n.normalize())
        break
      }
    }
  }
  let min = Infinity
  for (const d of dirs) {
    let lo = Infinity
    let hi = -Infinity
    for (const p of extreme) {
      const x = p.dot(d)
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
    min = Math.min(min, hi - lo)
  }
  return min
}

const pt = (v: THREE.Vector3) => `(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`

/** Parts bucketed by the x/z cells their boxes cover, so a point query reads only its neighbours. */
class SurfaceGrid {
  private readonly cells = new Map<string, Part[]>()
  /** Parts too big to bucket (the ground plane): checked on every query. */
  private readonly big: Part[] = []
  private static readonly CELL = 8

  constructor(parts: Part[]) {
    const c = SurfaceGrid.CELL
    for (const p of parts) {
      const [x0, x1, z0, z1] = [Math.floor(p.box.min.x / c), Math.floor(p.box.max.x / c), Math.floor(p.box.min.z / c), Math.floor(p.box.max.z / c)]
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) {
        this.big.push(p)
        continue
      }
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`
          const list = this.cells.get(key) ?? []
          list.push(p)
          this.cells.set(key, list)
        }
      }
    }
  }

  near(v: THREE.Vector3): Part[] {
    const c = SurfaceGrid.CELL
    return [...(this.cells.get(`${Math.floor(v.x / c)},${Math.floor(v.z / c)}`) ?? []), ...this.big]
  }
}

/** Whether `v` lies within CONTACT_TOLERANCE of one of `part`'s triangles. */
const touches = (part: Part, v: THREE.Vector3): boolean => {
  if (part.box.distanceToPoint(v) > CONTACT_TOLERANCE) return false
  const tri = new THREE.Triangle()
  const q = new THREE.Vector3()
  const p = part.positions
  for (let t = 0; t + 2 < part.tris.length; t += 3) {
    tri.a.fromArray(p, part.tris[t] * 3)
    tri.b.fromArray(p, part.tris[t + 1] * 3)
    tri.c.fromArray(p, part.tris[t + 2] * 3)
    if (tri.closestPointToPoint(v, q).distanceTo(v) <= CONTACT_TOLERANCE) return true
  }
  return false
}

/** Edges of an open part used by one triangle only, whose middle is neither on the ground nor on another surface. */
const freeEdges = (part: Part, grid: SurfaceGrid): [THREE.Vector3, THREE.Vector3][] => {
  const uses = new Map<string, [number, number, number]>()
  for (let t = 0; t + 2 < part.tris.length; t += 3) {
    for (const [a, b] of [[part.tris[t], part.tris[t + 1]], [part.tris[t + 1], part.tris[t + 2]], [part.tris[t + 2], part.tris[t]]]) {
      if (a === b) continue
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const e = uses.get(key)
      uses.set(key, e ? [e[0], e[1], e[2] + 1] : [a, b, 1])
    }
  }
  const out: [THREE.Vector3, THREE.Vector3][] = []
  for (const [a, b, n] of uses.values()) {
    if (n !== 1) continue
    const va = new THREE.Vector3().fromArray(part.positions, a * 3)
    const vb = new THREE.Vector3().fromArray(part.positions, b * 3)
    const mid = va.clone().add(vb).multiplyScalar(0.5)
    if (mid.y <= CONTACT_TOLERANCE) continue // on the ground
    if (grid.near(mid).some((s) => s !== part && touches(s, mid))) continue
    out.push([va, vb])
  }
  return out
}

const size = (box: THREE.Box3) => {
  const s = box.getSize(new THREE.Vector3())
  return `${fmt(s.x)}×${fmt(s.y)}×${fmt(s.z)} m at (${fmt(box.min.x)}, ${fmt(box.min.y)}, ${fmt(box.min.z)})`
}

/** Lint every mesh under `root` (world matrices are updated first). */
export const lintScene = (root: THREE.Object3D): LintResult => {
  root.updateMatrixWorld(true)
  const offenders: Offender[] = []
  const flatByReason: Partial<Record<FlatReason, number>> = {}
  const meshes: THREE.Mesh[] = []
  const structuralParts: (Part & { kind: StructuralKind })[] = []
  /** Everything a structural part may stand on: every part of every mesh but the `airborne` ones. */
  const surfaces: Part[] = []
  /** Non-flat parts, judged for thickness once every surface is known. */
  const judged: (Part & { label: string })[] = []
  let structuralCount = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    meshes.push(mesh)
    const name = nameOf(mesh)
    const flatTag = tagOf(mesh, 'flat')
    const kindTag = tagOf(mesh, 'kind')
    if (flatTag !== undefined && !FLAT_REASONS.includes(flatTag as FlatReason)) {
      offenders.push({ check: 'tag', mesh: name, detail: `unknown flat reason "${String(flatTag)}"` })
      return
    }
    if (kindTag !== undefined && !STRUCTURAL_KINDS.includes(kindTag as StructuralKind)) {
      offenders.push({ check: 'tag', mesh: name, detail: `unknown structural kind "${String(kindTag)}"` })
      return
    }
    if (flatTag !== undefined && kindTag !== undefined) {
      offenders.push({ check: 'tag', mesh: name, detail: `tagged both flat "${String(flatTag)}" and kind "${String(kindTag)}"` })
      return
    }
    if (flatTag !== undefined) {
      const r = flatTag as FlatReason
      flatByReason[r] = (flatByReason[r] ?? 0) + 1
      if (r !== 'airborne') surfaces.push(surfacePart(mesh, name))
      return // flat: no thickness check, and nothing that must stand
    }
    if (kindTag !== undefined) structuralCount++
    const parts = (mesh as THREE.InstancedMesh).isInstancedMesh ? instanceParts(mesh as THREE.InstancedMesh, name) : meshParts(mesh, name)
    surfaces.push(...parts)
    for (const [k, part] of parts.entries()) {
      const label = parts.length > 1 && part.instance === undefined ? `${name}@${k}` : part.name
      judged.push(Object.assign(part, { label }))
      if (kindTag !== undefined) structuralParts.push(Object.assign(part, { name: label, kind: kindTag as StructuralKind }))
    }
  })

  // Thin: a closed part is judged by its own thickness. An open sheet has no thickness of its own:
  // it is a face of something bigger (a body's wall, its lid, one material of a rock) when every edge
  // it ends in is on the ground or meets another surface. A free edge — a wall's end standing in the
  // air with no cap, a lone board — is where it shows as paper.
  const grid = new SurfaceGrid(surfaces)
  for (const p of judged) {
    if (closed(p.tris)) {
      const t = thickness(p.positions, p.tris)
      if (t < MIN_THICKNESS) offenders.push({ check: 'thin', mesh: p.label, detail: `${fmt(t)} m thick (min ${MIN_THICKNESS}); ${size(p.box)}` })
      continue
    }
    const free = freeEdges(p, grid)
    if (free.length > 0) {
      const [a, b] = free[0]
      offenders.push({ check: 'thin', mesh: p.label, detail: `open sheet with ${free.length} free edge${free.length > 1 ? 's' : ''}, e.g. ${pt(a)} → ${pt(b)}; ${size(p.box)}` })
    }
  }

  // Floating: a structural part stands when its foot is on the ground (y 0), or a ray down from its
  // foot meets another surface within CONTACT_TOLERANCE. A non-load-bearing part (deck, body, stand,
  // sign) also stands when it touches a part that stands (a deck on its pillars, a board on its posts).
  const onFoot = (part: Part): boolean => {
    if (part.box.min.y <= CONTACT_TOLERANCE) return true
    const feet = [...new Set(part.tris)].filter((i) => part.positions[i * 3 + 1] <= part.box.min.y + 0.01)
    return feet.some((i) => {
      const [x, y, z] = [part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2]]
      return surfaces.some((s) => s !== part && carries(s, x, y, z))
    })
  }
  const standing = new Set<Part>(structuralParts.filter((p) => p.box.min.y <= CONTACT_TOLERANCE))
  const spread = () => {
    for (let grew = true; grew; ) {
      grew = false
      for (const p of structuralParts) {
        if (standing.has(p) || LOAD_BEARING.includes(p.kind)) continue
        const reach = p.box.clone().expandByScalar(CONTACT_TOLERANCE)
        if ([...standing].some((s) => reach.intersectsBox(s.box))) {
          standing.add(p)
          grew = true
        }
      }
    }
  }
  // Cheap contacts first; rays only for what is still unsupported.
  spread()
  for (const p of structuralParts) if (!standing.has(p) && onFoot(p)) standing.add(p)
  spread()
  for (const p of structuralParts) {
    if (!standing.has(p)) offenders.push({ check: 'floating', mesh: p.name, detail: `${p.kind}, foot ${fmt(p.box.min.y)} m up with nothing under it; ${size(p.box)}` })
  }
  return { meshes: meshes.length, structural: structuralCount, flatByReason, offenders }
}
