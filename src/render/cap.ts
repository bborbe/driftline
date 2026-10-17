// Closes the holes of an open mesh: every boundary loop (edges used by one triangle only, welded at
// 1 mm as lint.ts welds them) gets a fan of triangles to its centroid, wound against the edge's own
// triangle so the cap faces outward. Used on Kenney models shipped open underneath (the foliage
// cones of tree_pineRoundC); the cap is code-generated, no new asset.
import * as THREE from 'three/webgpu'

/** Vertices closer than 1 mm are one vertex (same weld as lint.ts). */
const weldKey = (pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
  `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`

/**
 * Boundary loops as simple cycles of vertex indices, each wound against its edges' own triangles. A
 * boundary edge is one used an odd number of times (lint.ts's test): 1 on an open rim, 3 where a
 * Kenney cone tier meets the next. Every vertex has an even number of them (its triangles use its
 * edges 2× each in total), so they split into cycles without a dead end.
 */
export const boundaryLoops = (geo: THREE.BufferGeometry): number[][] => {
  const pos = geo.attributes.position
  const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i)
  const weld = Array.from({ length: pos.count }, (_, i) => weldKey(pos, i))
  // Per undirected welded edge: uses, net winding (+1 per use lo → hi) and a vertex index per end.
  const edges = new Map<string, { n: number; net: number; lo: number; hi: number }>()
  for (let t = 0; t + 2 < index.length; t += 3) {
    for (const [a, b] of [[index[t], index[t + 1]], [index[t + 1], index[t + 2]], [index[t + 2], index[t]]]) {
      if (weld[a] === weld[b]) continue
      const [lo, hi, dir] = weld[a] < weld[b] ? [a, b, 1] : [b, a, -1]
      const key = `${weld[lo]}|${weld[hi]}`
      const e = edges.get(key) ?? { n: 0, net: 0, lo, hi }
      e.n++
      e.net += dir
      edges.set(key, e)
    }
  }
  const free = [...edges.values()].filter((e) => e.n % 2 === 1)
  const adj = new Map<string, number[]>()
  for (const [i, e] of free.entries()) {
    for (const v of [e.lo, e.hi]) adj.set(weld[v], [...(adj.get(weld[v]) ?? []), i])
  }
  const used = new Set<number>()
  const cycles: number[][] = []
  /** Close the cycle of edges `path` and orient it against its edges' net winding. */
  const emit = (verts: number[], path: number[]) => {
    let agree = 0
    for (const [k, i] of path.entries()) agree += weld[verts[k]] === weld[free[i].lo] ? free[i].net : -free[i].net
    cycles.push(agree > 0 ? [...verts].reverse() : verts)
  }
  for (const start of adj.keys()) {
    // Walk unused edges; the walk can only end where it began. A revisit splits a simple cycle off.
    const verts: number[] = []
    const path: number[] = []
    let at = start
    let vertex = free[adj.get(start)![0]].lo
    if (weld[vertex] !== start) vertex = free[adj.get(start)![0]].hi
    for (;;) {
      const i = adj.get(at)!.find((j) => !used.has(j))
      if (i === undefined) break
      used.add(i)
      const e = free[i]
      const nextVertex = weld[e.lo] === at ? e.hi : e.lo
      verts.push(vertex)
      path.push(i)
      at = weld[nextVertex]
      vertex = nextVertex
      const seen = verts.findIndex((v) => weld[v] === at)
      if (seen >= 0) {
        emit(verts.splice(seen), path.splice(seen))
      }
    }
  }
  return cycles.filter((c) => c.length >= 3)
}

/**
 * A copy of `geo` with every boundary loop capped, or `geo` itself when it has none. Cap vertices are
 * their own, carrying the cap's flat normal; other attributes (uv) copy the rim vertex's values.
 */
export const capOpenEdges = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
  const loops = boundaryLoops(geo)
  if (loops.length === 0) return geo
  const pos = geo.attributes.position
  const names = Object.keys(geo.attributes)
  const data: Record<string, number[]> = {}
  for (const name of names) {
    const attr = geo.attributes[name]
    data[name] = []
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) data[name].push(attr.getComponent(i, k))
  }
  const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i)
  const base = index.length
  let next = pos.count
  /** A new vertex at `p` with normal `n`, other attributes copied from vertex `from`. */
  const add = (from: number, p: THREE.Vector3, n: THREE.Vector3): number => {
    for (const name of names) {
      const attr = geo.attributes[name]
      const values = name === 'position' ? [p.x, p.y, p.z] : name === 'normal' ? [n.x, n.y, n.z] : Array.from({ length: attr.itemSize }, (_, k) => attr.getComponent(from, k))
      data[name].push(...values)
    }
    return next++
  }
  for (const loop of loops) {
    const rim = loop.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i))
    const centre = rim.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(rim.length)
    // Newell normal of the loop as wound: the cap's outward face.
    const normal = new THREE.Vector3()
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i]
      const b = rim[(i + 1) % rim.length]
      normal.x += (a.y - b.y) * (a.z + b.z)
      normal.y += (a.z - b.z) * (a.x + b.x)
      normal.z += (a.x - b.x) * (a.y + b.y)
    }
    normal.normalize()
    const c = add(loop[0], centre, normal)
    const ids = loop.map((i, k) => add(i, rim[k], normal))
    for (let i = 0; i < ids.length; i++) index.push(ids[i], ids[(i + 1) % ids.length], c)
  }
  const capped = new THREE.BufferGeometry()
  for (const name of names) {
    const attr = geo.attributes[name]
    capped.setAttribute(name, new THREE.Float32BufferAttribute(data[name], attr.itemSize, attr.normalized))
  }
  capped.setIndex(index)
  for (const g of geo.groups) capped.addGroup(g.start, g.count, g.materialIndex)
  if (geo.groups.length > 0) capped.addGroup(base, index.length - base, geo.groups[0].materialIndex)
  capped.name = geo.name
  return capped
}
