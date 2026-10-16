// three.js wrapper around the pure track geometry: one mesh per segment plus gate arches.
import * as THREE from 'three/webgpu'
import { gatePillars, poses, type Pillar, type Track } from '../../track/schema'
import { buildApron, buildTrack, PROFILE, type Band, type SegmentGeometry } from './geometry'

// The Kenney pieces' own material colours (glTF baseColorFactor, linear), so procedural
// segments and glb pieces read as one road.
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
const BAND: Record<Band, THREE.Color> = {
  road: linear(0.267, 0.267, 0.267),
  curb: linear(0.945, 0.949, 0.965),
  grass: linear(0.302, 0.561, 0.431),
}

/** Shared with the Kenney pieces (kenney.ts), so both kinds of road read equally glossy. */
export const ROAD_ROUGHNESS = 0.5

const roadMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  // Glossy, Trackmania-like: the HDRI environment (scene.ts) gives the clearcoat something to reflect.
  roughness: ROAD_ROUGHNESS,
  clearcoat: 0.3,
  clearcoatRoughness: 0.25,
  metalness: 0,
  side: THREE.DoubleSide,
  shadowSide: THREE.BackSide, // a double-sided caster would otherwise shadow itself (acne)
})

/** Banked-turn verge: grass apron on the inside, grey (Kenney wall) skirt on the outside. */
const vergeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })

const toBufferGeometry = (g: SegmentGeometry): THREE.BufferGeometry => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1))
  const colors = new Float32Array(g.positions.length)
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.perRow; c++) BAND[PROFILE[c][2]].toArray(colors, (r * g.perRow + c) * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

// Pillars from gatePillars() — the same boxes the physics collides with — plus a beam across.
const gateArch = (kind: 'start-finish' | 'checkpoint', pillars: Pillar[]): THREE.Group => {
  const color = kind === 'start-finish' ? 0xffffff : 0x4cc9f0
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
  const arch = new THREE.Group()
  for (const p of pillars) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(2 * p.halfWidth, p.height, 2 * p.halfDepth), mat)
    pillar.position.set(p.x, p.y + p.height / 2, p.z)
    pillar.rotation.y = p.heading
    arch.add(pillar)
  }
  const [a, b] = pillars
  const span = Math.hypot(b.x - a.x, b.z - a.z) + 2 * a.halfWidth
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.2, 2 * a.halfDepth), mat)
  beam.position.set((a.x + b.x) / 2, a.y + a.height, (a.z + b.z) / 2)
  beam.rotation.y = a.heading
  arch.add(beam)
  arch.traverse((o) => (o.castShadow = true))
  return arch
}

/**
 * Build the track procedurally as a scene-graph group. `segments` and `gates`
 * restrict it to those indices (the piece renderer's fallbacks); omitted = all.
 */
export const createTrackMesh = (track: Track, segments?: number[], gates?: number[]): THREE.Group => {
  const group = new THREE.Group()
  group.name = `track:${track.name}`
  const ps = poses(track)
  buildTrack(track).forEach((g, i) => {
    if (segments && !segments.includes(i)) return
    const mesh = new THREE.Mesh(toBufferGeometry(g), roadMaterial)
    mesh.receiveShadow = true
    group.add(mesh)
    const apron = buildApron(ps[i], track.segments[i])
    if (apron) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(apron.positions, 3))
      geo.setIndex(new THREE.BufferAttribute(apron.indices, 1))
      const colors = new Float32Array(apron.positions.length)
      for (let r = 0; r < apron.rows; r++) {
        // inner edge, apron rim: grass; outer edge, skirt foot: curb grey
        ;[BAND.grass, BAND.grass, BAND.curb, BAND.curb].forEach((col, k) => col.toArray(colors, (r * apron.perRow + k) * 3))
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geo.computeVertexNormals()
      const verge = new THREE.Mesh(geo, vergeMaterial)
      verge.receiveShadow = true
      group.add(verge)
    }
  })
  for (const [i, gate] of track.gates.entries()) {
    if (gates && !gates.includes(i)) continue
    group.add(gateArch(gate.kind, gatePillars(track, gate)))
  }
  return group
}
