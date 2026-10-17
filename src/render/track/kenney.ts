// Hybrid track renderer: Kenney glb pieces where planPieces() maps a segment,
// procedural meshes (mesh.ts) for the rest.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Track } from '../../track/schema'
import { createBarriers, createRampSupports, createTrackMesh, ROAD_ROUGHNESS } from './mesh'
import { ASPHALT } from '../look'
import { planGateLegs, planPieces, type GateLeg } from './kenney-plan'
import { createPad } from './pad'
import { createZoneMeshes } from './zones'
import { flat, structural, type FlatReason } from '../tags'

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
        if (mat.name === 'road') std.color.copy(ASPHALT) // same asphalt as the procedural road (look.ts)
      }
    }
  })
  return root
}

/**
 * Kenney piece materials as geometry tags (tags.ts): the asphalt and verge are road, the grey kerbs a
 * curb strip. The checkpoint piece is an arch, not road: its legs must stand. The start piece's arch
 * shares the grey of its kerbs.
 */
const PIECE_FLAT: Record<string, FlatReason> = { road: 'road', grass: 'road', grey: 'curb' }

const tagPiece = (piece: string, root: THREE.Object3D): THREE.Object3D => {
  if (piece === 'checkpoint') return structural(root, 'gate-leg')
  root.traverse((o) => {
    const reason = PIECE_FLAT[((o as THREE.Mesh).material as THREE.Material | undefined)?.name ?? '']
    if ((o as THREE.Mesh).isMesh && reason) flat(o, reason)
  })
  return root
}

/**
 * The legs of elevated checkpoints carried down to the ground (planGateLegs), drawn with the
 * checkpoint piece's own material, so each leg is one column above and below the deck line.
 * They collide as gateLegs() (src/track/shapes.ts), in the same section.
 */
export const createGateLegs = (legs: GateLeg[], checkpoint: THREE.Object3D): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'gate-legs'
  let material: THREE.Material | THREE.Material[] | undefined
  checkpoint.traverse((o) => (material ??= (o as THREE.Mesh).material))
  if (!material) throw new Error('checkpoint piece has no material')
  for (const l of legs) {
    const leg = structural(new THREE.Mesh(new THREE.BoxGeometry(2 * l.halfWidth, l.height, 2 * l.halfDepth), material), 'gate-leg')
    leg.position.set(l.x, l.height / 2, l.z)
    leg.rotation.y = l.heading
    leg.castShadow = leg.receiveShadow = true
    group.add(leg)
  }
  return group
}

export const createPieceTrack = async (track: Track): Promise<THREE.Group> => {
  // A free-drive pad is its slab, guides and walls: its lane is painted, not a road piece.
  if (track.pad) {
    const group = new THREE.Group()
    group.add(createPad(track), createBarriers(track))
    return group
  }
  const plan = planPieces(track)
  const loader = new GLTFLoader()
  const names = [...new Set(plan.placements.map((p) => p.piece))]
  const models = new Map<string, THREE.Object3D>()
  await Promise.all(
    names.map(async (n) => {
      const gltf = await loader.loadAsync(urlFor(n))
      models.set(n, tagPiece(n, preparePiece(gltf.scene)))
    }),
  )

  const group = createTrackMesh(track, plan.procedural, plan.proceduralGates)
  group.add(createRampSupports(track))
  group.add(createBarriers(track))
  group.add(createZoneMeshes(track))
  const legs = planGateLegs(plan)
  if (legs.length > 0) group.add(createGateLegs(legs, models.get('checkpoint')!))
  for (const p of plan.placements) {
    const obj = models.get(p.piece)!.clone()
    obj.position.set(p.pose.x, p.pose.y, p.pose.z)
    obj.rotation.y = p.pose.heading
    obj.scale.set(...p.scale)
    group.add(obj)
  }
  return group
}
