// Paints a livery (livery.ts) onto any registry car. The body's paint triangles — the saturated
// colormap texels of a Kenney glb, or the clearcoat materials of a code-built car — move into a
// child mesh whose UVs project into the livery atlas: top, left, right and end bands by face
// normal. The wheels and the unpainted parts (glass, carbon, lights) keep their own materials.
// Render-only; repainting redraws the one canvas texture, so a Settings change shows at once.
import * as THREE from 'three/webgpu'
import { WHEEL_NODES } from '../../car/wheels'
import { anisotropy } from '../anisotropy'
import { isDetail } from './detail'
import { bandRange, drawLivery, type Band, type Draw2D, type Livery } from './livery'

export const LIVERY_SIZE = 1024
const PAD = 0.04 // band inset, so texture filtering never samples the neighbouring band

/** A canvas-like surface: a real canvas in the browser, a fake in tests. */
export type LiveryCanvas = { width: number; height: number; getContext(type: '2d'): unknown }

const defaultCanvas = (): LiveryCanvas | null => (typeof document === 'undefined' ? null : document.createElement('canvas'))

type Painted = { canvas: LiveryCanvas; texture: THREE.Texture }

const underWheel = (o: THREE.Object3D): boolean => {
  const wheels = new Set(Object.values(WHEEL_NODES))
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (wheels.has(p.name)) return true
  return false
}

/** Saturated, mid-bright texels are paint; greys, darks and whites are glass, trim and lights. */
const isPaintTexel = (r: number, g: number, b: number): boolean => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max > 0.35 && (max - min) / max > 0.45
}

/** Per-triangle paint test from the material's colormap; null when there is nothing to sample. */
const texelTest = (mat: THREE.MeshStandardMaterial, uv: THREE.BufferAttribute | undefined) => {
  const image = mat.map?.image as CanvasImageSource & { width: number; height: number } | undefined
  if (!image || !uv || typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(image, 0, 0)
  const px = g.getImageData(0, 0, c.width, c.height).data
  const flipY = mat.map!.flipY
  return (i: number): boolean => {
    let u = 0
    let v = 0
    for (let k = 0; k < 3; k++) {
      u += uv.getX(i * 3 + k) / 3
      v += uv.getY(i * 3 + k) / 3
    }
    const x = Math.min(c.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * c.width)))
    const fv = v - Math.floor(v)
    const y = Math.min(c.height - 1, Math.max(0, Math.floor((flipY ? 1 - fv : fv) * c.height)))
    const o = (y * c.width + x) * 4
    return isPaintTexel(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255)
  }
}

/** Which triangles of `mesh` are paint, or null when the whole mesh is (or is not) paint. */
const paintTriangles = (mesh: THREE.Mesh, geo: THREE.BufferGeometry): boolean[] | 'all' | 'none' => {
  const mat = mesh.material as THREE.MeshStandardMaterial
  if (Array.isArray(mesh.material)) return 'none'
  if (mat.map) {
    const test = texelTest(mat, geo.getAttribute('uv') as THREE.BufferAttribute | undefined)
    if (!test) return 'none'
    const n = geo.getAttribute('position').count / 3
    return Array.from({ length: n }, (_, i) => test(i))
  }
  return (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ? 'all' : 'none'
}

/** The livery UV of one corner: band by face normal, position by the car's paint bounds. */
const liveryUV = (p: THREE.Vector3, n: THREE.Vector3, box: THREE.Box3, out: [number, number]): void => {
  const size = box.getSize(new THREE.Vector3())
  const along = (p.z - box.min.z) / (size.z || 1)
  const across = (p.x - box.min.x) / (size.x || 1)
  const up = (p.y - box.min.y) / (size.y || 1)
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  let band: Band
  let u: number
  let w: number
  if (ay >= ax && ay >= az) [band, u, w] = ['top', along, across]
  else if (ax >= az) [band, u, w] = n.x > 0 ? ['left', 1 - along, up] : ['right', along, up]
  else [band, u, w] = ['end', n.z > 0 ? 1 - across : across, up]
  const [v0, v1] = bandRange(band)
  const h = v1 - v0
  out[0] = Math.min(1, Math.max(0, u))
  out[1] = v0 + h * (PAD + (1 - 2 * PAD) * Math.min(1, Math.max(0, w)))
}

/** Split `mesh` into its unpainted part (in place) and a livery child mesh; returns the child or null. */
const splitPaint = (mesh: THREE.Mesh, toRoot: THREE.Matrix4, box: THREE.Box3, material: THREE.Material): THREE.Mesh | null => {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
  const which = paintTriangles(mesh, geo)
  if (which === 'none') return null
  const pos = geo.getAttribute('position')
  const tris = pos.count / 3
  const paint = which === 'all' ? Array(tris).fill(true) : which
  const keep: number[] = []
  const take: number[] = []
  for (let i = 0; i < tris; i++) (paint[i] ? take : keep).push(i)
  if (take.length === 0) return null

  const pick = (src: THREE.BufferGeometry, idx: number[]): THREE.BufferGeometry => {
    const out = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(src.attributes)) {
      const a = attr as THREE.BufferAttribute
      const arr = new (a.array.constructor as Float32ArrayConstructor)(idx.length * 3 * a.itemSize)
      idx.forEach((t, j) => {
        for (let k = 0; k < 3 * a.itemSize; k++) arr[j * 3 * a.itemSize + k] = a.array[t * 3 * a.itemSize + k]
      })
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized))
    }
    return out
  }

  const painted = pick(geo, take)
  const uv = new Float32Array((painted.getAttribute('position').count) * 2)
  const pp = painted.getAttribute('position')
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const corner: [number, number] = [0, 0]
  for (let t = 0; t < pp.count / 3; t++) {
    a.fromBufferAttribute(pp, t * 3).applyMatrix4(toRoot)
    b.fromBufferAttribute(pp, t * 3 + 1).applyMatrix4(toRoot)
    c.fromBufferAttribute(pp, t * 3 + 2).applyMatrix4(toRoot)
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize()
    for (const [k, p] of [a, b, c].entries()) {
      liveryUV(p, n, box, corner)
      uv[(t * 3 + k) * 2] = corner[0]
      uv[(t * 3 + k) * 2 + 1] = corner[1]
    }
  }
  painted.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  if (!painted.getAttribute('normal')) painted.computeVertexNormals()

  mesh.geometry = keep.length > 0 ? pick(geo, keep) : new THREE.BufferGeometry()
  const child = new THREE.Mesh(painted, material)
  child.name = 'livery'
  child.castShadow = mesh.castShadow
  child.receiveShadow = mesh.receiveShadow
  return child
}

/** Bounds, in the car root's frame, of every vertex of the given meshes. */
const boundsOf = (root: THREE.Object3D, meshes: THREE.Mesh[]): THREE.Box3 => {
  const box = new THREE.Box3()
  const inv = root.matrixWorld.clone().invert()
  const p = new THREE.Vector3()
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    const toRoot = inv.clone().multiply(m.matrixWorld)
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(toRoot))
  }
  return box
}

/**
 * Paint `livery` onto the car under `root`. The first call converts the body; later calls only
 * redraw the livery texture. Without a canvas (headless tests with no fake) it does nothing.
 */
export const applyLivery = (root: THREE.Object3D, livery: Livery, makeCanvas: () => LiveryCanvas | null = defaultCanvas): void => {
  let painted = root.userData.livery as Painted | undefined
  if (!painted) {
    const canvas = makeCanvas()
    if (!canvas) return
    canvas.width = LIVERY_SIZE
    canvas.height = LIVERY_SIZE
    const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy()
    const material = new THREE.MeshPhysicalMaterial({ map: texture, clearcoat: 1, roughness: 0.35, name: 'livery' })
    root.updateMatrixWorld(true)
    const body: THREE.Mesh[] = []
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !underWheel(o) && !isDetail(o)) body.push(o as THREE.Mesh)
    })
    const inv = root.matrixWorld.clone().invert()
    const box = boundsOf(root, body)
    for (const mesh of body) {
      const child = splitPaint(mesh, inv.clone().multiply(mesh.matrixWorld), box, material)
      if (child) mesh.add(child)
    }
    painted = { canvas, texture }
    root.userData.livery = painted
  }
  const g = painted.canvas.getContext('2d') as Draw2D | null
  if (!g) return
  drawLivery(g, livery, LIVERY_SIZE)
  painted.texture.needsUpdate = true
}
