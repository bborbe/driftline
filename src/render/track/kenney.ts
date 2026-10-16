// Hybrid track renderer: Kenney glb pieces where planPieces() maps a segment,
// procedural meshes (mesh.ts) for the rest.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Track } from '../../track/schema'
import { createTrackMesh } from './mesh'
import { planPieces } from './pieces'

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

export const createPieceTrack = async (track: Track): Promise<THREE.Group> => {
  const plan = planPieces(track)
  const loader = new GLTFLoader()
  const names = [...new Set(plan.placements.map((p) => p.piece))]
  const models = new Map<string, THREE.Object3D>()
  await Promise.all(
    names.map(async (n) => {
      const gltf = await loader.loadAsync(urlFor(n))
      gltf.scene.traverse((o) => {
        o.castShadow = true
        o.receiveShadow = true
      })
      models.set(n, gltf.scene)
    }),
  )

  const group = createTrackMesh(track, plan.procedural, plan.proceduralGates)
  for (const p of plan.placements) {
    const obj = models.get(p.piece)!.clone()
    obj.position.set(p.pose.x, p.pose.y, p.pose.z)
    obj.rotation.y = p.pose.heading
    obj.scale.set(...p.scale)
    group.add(obj)
  }
  return group
}
