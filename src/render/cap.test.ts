import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { boundaryLoops, capOpenEdges } from './cap'
import { closed } from './lint'
import { OPEN_MODELS } from './scenery'

const tris = (geo: THREE.BufferGeometry): number[] => {
  // Welded at 1 mm, as lint.ts judges a part.
  const pos = geo.attributes.position
  const ids = new Map<string, number>()
  const weld = Array.from({ length: pos.count }, (_, i) => {
    const key = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`
    if (!ids.has(key)) ids.set(key, ids.size)
    return ids.get(key)!
  })
  return Array.from(geo.index!.array, (i) => weld[i])
}

/** Signed volume (divergence theorem): positive when every face is wound outward. */
const volume = (geo: THREE.BufferGeometry): number => {
  const pos = geo.attributes.position
  const idx = geo.index!.array
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  let v = 0
  for (let t = 0; t + 2 < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t])
    b.fromBufferAttribute(pos, idx[t + 1])
    c.fromBufferAttribute(pos, idx[t + 2])
    v += a.dot(b.clone().cross(c)) / 6
  }
  return v
}

const loadKit = async (model: string): Promise<THREE.Mesh[]> => {
  const buf = readFileSync(`${process.cwd()}/assets/nature-kit/${model}.glb`)
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
  const meshes: THREE.Mesh[] = []
  gltf.scene.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh))
  return meshes
}

describe('capOpenEdges', () => {
  it('closes an open cone with an outward-facing base', () => {
    const cone = new THREE.ConeGeometry(1, 2, 8, 1, true)
    expect(closed(tris(cone))).toBe(false)
    expect(boundaryLoops(cone)).toHaveLength(1)
    const capped = capOpenEdges(cone)
    expect(closed(tris(capped))).toBe(true)
    expect(boundaryLoops(capped)).toHaveLength(0)
    // A solid cone, r 1, h 2: π·r²·h / 3 for a round one; the 8-gon is a little less.
    expect(volume(capped)).toBeGreaterThan(1.8)
    expect(volume(capped)).toBeLessThan((Math.PI * 2) / 3)
    // The base faces down.
    const n = capped.attributes.normal
    expect(n.getY(n.count - 1)).toBeCloseTo(-1)
  })

  it('returns a closed geometry unchanged', () => {
    const box = new THREE.BoxGeometry()
    expect(capOpenEdges(box)).toBe(box)
  })

  it('tree_pineRoundC: every open mesh of the shipped model comes out closed, wound outward', async () => {
    expect(OPEN_MODELS).toContain('tree_pineRoundC')
    const meshes = await loadKit('tree_pineRoundC')
    const leaves = meshes.find((m) => (m.material as THREE.Material).name === 'leafsDark')!
    expect(boundaryLoops(leaves.geometry).length).toBeGreaterThan(0)
    for (const m of meshes) {
      const capped = capOpenEdges(m.geometry)
      expect(closed(tris(capped)), m.name).toBe(true)
      expect(volume(capped), m.name).toBeGreaterThan(0)
    }
  })

})
