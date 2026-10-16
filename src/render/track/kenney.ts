// Hybrid track renderer: Kenney glb pieces where planPieces() maps a segment,
// procedural meshes (mesh.ts) for the rest.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Track } from '../../track/schema'
import { createBarriers, createRampSupports, createTrackMesh, ROAD_ROUGHNESS } from './mesh'
import { planPieces } from './pieces'
import { createZoneMeshes } from './zones'

// Vite bundles each piece and hands back its URL, so the build works under any base path.
const PIECE_URLS = import.meta.glob('/assets/pieces/*.glb', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>

const urlFor = (piece: string): string => {
  const url = PIECE_URLS[`/assets/pieces/${piece}.glb`]
  if (!url) throw new Error(`no asset for track piece "${piece}"`)
  return url
}

/**
 * Shadows on, and every material double-sided (back-face shadow casting): the Kenney pieces are single-sided, so an
 * elevated ramp or bridge was see-through from the grass below (backface culling).
 */
export const preparePiece = (root: THREE.Object3D): THREE.Object3D => {
  root.traverse((o) => {
    o.castShadow = true
    o.receiveShadow = true
    const m = (o as THREE.Mesh).material
    if (m) {
      for (const mat of Array.isArray(m) ? m : [m]) {
        mat.side = THREE.DoubleSide
        // Cast shadows from the back face only: a double-sided caster shadows its own
        // front face, which showed as moiré striping (shadow acne) on the road.
        mat.shadowSide = THREE.BackSide
        const std = mat as THREE.MeshStandardMaterial
        if (std.isMeshStandardMaterial) std.roughness = Math.min(std.roughness, ROAD_ROUGHNESS)
      }
    }
  })
  return root
}

export const createPieceTrack = async (track: Track): Promise<THREE.Group> => {
  const plan = planPieces(track)
  const loader = new GLTFLoader()
  const names = [...new Set(plan.placements.map((p) => p.piece))]
  const models = new Map<string, THREE.Object3D>()
  await Promise.all(
    names.map(async (n) => {
      const gltf = await loader.loadAsync(urlFor(n))
      models.set(n, preparePiece(gltf.scene))
    }),
  )

  const group = createTrackMesh(track, plan.procedural, plan.proceduralGates)
  group.add(createRampSupports(track))
  group.add(createBarriers(track))
  group.add(createZoneMeshes(track))
  for (const p of plan.placements) {
    const obj = models.get(p.piece)!.clone()
    obj.position.set(p.pose.x, p.pose.y, p.pose.z)
    obj.rotation.y = p.pose.heading
    obj.scale.set(...p.scale)
    group.add(obj)
  }
  return group
}
