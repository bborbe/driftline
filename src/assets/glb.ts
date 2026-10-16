// Minimal GLB reader for tests and build scripts: returns the glTF JSON chunk.
// Node-only (uses fs); never import from src/physics/ or browser code.
import { readFileSync } from 'node:fs'

export interface GltfNode {
  name?: string
  mesh?: number
  children?: number[]
  translation?: [number, number, number]
}

export interface Gltf {
  nodes: GltfNode[]
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[]
  accessors: { count: number; min?: number[]; max?: number[] }[]
}

export function readGlb(path: string): Gltf {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB file`)
  const len = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Gltf
}
