// Bake many copies of models into ONE static mesh: the decor is a few thousand triangles but a
// hundred-odd objects, and on WebGL2 every draw call costs more than its triangles. Each copy's
// transform is applied to the vertices; a material's flat colour becomes a vertex colour, so one
// matte material draws everything.
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Placement matrix: stand on (x, y, z), turned to `heading` (0 = +z), scaled (uniform or per axis). */
export const placement = (x: number, y: number, z: number, heading: number, scale: number | [number, number, number] = 1): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading),
    typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale),
  )

/** A geometry reduced to position, normal, colour and uv (non-indexed), so any set of them merges. */
export const prepared = (g: THREE.BufferGeometry, color: THREE.Color, matrix: THREE.Matrix4, uv?: (u: number, v: number, i: number) => [number, number]): THREE.BufferGeometry => {
  const src = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(matrix)
  const n = src.attributes.position.count
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', src.attributes.position)
  if (!src.attributes.normal) src.computeVertexNormals()
  out.setAttribute('normal', src.attributes.normal)
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) color.toArray(colors, i * 3)
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const uvs = new Float32Array(n * 2)
  const srcUv = src.attributes.uv
  for (let i = 0; i < n; i++) uvs.set(uv ? uv(srcUv?.getX(i) ?? 0, srcUv?.getY(i) ?? 0, i) : [0, 0], i * 2)
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  return out
}

/** Every sub-mesh of a loaded model, placed at each matrix, with its material colour baked in. */
export const bakeModel = (root: THREE.Object3D, placements: THREE.Matrix4[]): THREE.BufferGeometry[] => {
  root.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = mesh.geometry.groups.length > 0 ? mesh.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]
    for (const grp of groups) {
      const color = ((mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone()
      const geo = mesh.geometry.clone()
      if (mesh.geometry.groups.length > 0) {
        // Keep only this group's triangles.
        const idx = geo.index ? Array.from(geo.index.array).slice(grp.start, grp.start + grp.count) : null
        if (idx) geo.setIndex(idx)
        geo.clearGroups()
      }
      for (const p of placements) parts.push(prepared(geo, color, new THREE.Matrix4().multiplyMatrices(p, mesh.matrixWorld)))
    }
  })
  return parts
}

/** One mesh from many prepared parts. */
export const merged = (parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(parts.length > 0 ? mergeGeometries(parts) : new THREE.BufferGeometry(), material)
  mesh.matrixAutoUpdate = false
  return mesh
}
