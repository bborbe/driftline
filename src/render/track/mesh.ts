// three.js wrapper around the pure track geometry: one mesh per segment plus gate arches.
import * as THREE from 'three/webgpu'
import { gateLine, poses, type Track } from '../../track/schema'
import { buildApron, buildTrack, TRACK_WIDTH, type SegmentGeometry } from './geometry'

// Matched to the Kenney road pieces so procedural and glb segments read as one road.
const ROAD = new THREE.Color(0x9e9b96)
const CURB_A = new THREE.Color(0xf2f2ee)
const CURB_B = new THREE.Color(0xc9c8c3)

const roadMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  // Gloss stays low until an environment map exists: clearcoat with no env
  // reflects black at grazing angles. The HDRI scene step raises it.
  roughness: 0.55,
  metalness: 0,
  side: THREE.DoubleSide,
  shadowSide: THREE.BackSide, // a double-sided caster would otherwise shadow itself (acne)
})

/** Sloped verge around banked turns: grass-green, matched to the ground. */
const vergeMaterial = new THREE.MeshStandardMaterial({ color: 0x5e9a48, roughness: 0.9, side: THREE.DoubleSide })

const toBufferGeometry = (g: SegmentGeometry): THREE.BufferGeometry => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1))
  const colors = new Float32Array(g.positions.length)
  for (let r = 0; r < g.rows; r++) {
    // Curb stripes alternate every two rows (~3 m).
    const curb = Math.floor(r / 2) % 2 === 0 ? CURB_A : CURB_B
    for (let c = 0; c < g.perRow; c++) {
      const isCurbTop = c >= g.perRow - 2
      ;(isCurbTop ? curb : ROAD).toArray(colors, (r * g.perRow + c) * 3)
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

const gateArch = (kind: 'start-finish' | 'checkpoint'): THREE.Group => {
  const color = kind === 'start-finish' ? 0xffffff : 0x4cc9f0
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
  const arch = new THREE.Group()
  const span = TRACK_WIDTH + 2
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), mat)
    pillar.position.set((side * span) / 2, 3.5, 0)
    arch.add(pillar)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.8, 1.2, 0.8), mat)
  beam.position.y = 7
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
      geo.computeVertexNormals()
      const verge = new THREE.Mesh(geo, vergeMaterial)
      verge.receiveShadow = true
      group.add(verge)
    }
  })
  for (const [i, gate] of track.gates.entries()) {
    if (gates && !gates.includes(i)) continue
    const p = gateLine(track, gate)
    const arch = gateArch(gate.kind)
    arch.position.set(p.x, p.y, p.z)
    arch.rotation.y = p.heading
    group.add(arch)
  }
  return group
}
