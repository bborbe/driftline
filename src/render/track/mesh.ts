// three.js wrapper around the pure track geometry: one mesh per segment plus gate arches.
import * as THREE from 'three/webgpu'
import { gateLine, poses, type Track } from '../../track/schema'
import { buildApron, buildTrack, PROFILE, TRACK_WIDTH, type Band, type SegmentGeometry } from './geometry'

// The Kenney pieces' own material colours (glTF baseColorFactor, linear), so procedural
// segments and glb pieces read as one road.
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
const BAND: Record<Band, THREE.Color> = {
  road: linear(0.267, 0.267, 0.267),
  curb: linear(0.945, 0.949, 0.965),
  grass: linear(0.302, 0.561, 0.431),
}

const roadMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  // Gloss stays low until an environment map exists: clearcoat with no env
  // reflects black at grazing angles. The HDRI scene step raises it.
  roughness: 0.55,
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
    const p = gateLine(track, gate)
    const arch = gateArch(gate.kind)
    arch.position.set(p.x, p.y, p.z)
    arch.rotation.y = p.heading
    group.add(arch)
  }
  return group
}
