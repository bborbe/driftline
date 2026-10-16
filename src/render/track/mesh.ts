// three.js wrapper around the pure track geometry: one mesh per segment plus gate arches.
import * as THREE from 'three/webgpu'
import { ASPHALT } from '../look'
import { barrierPillars, barrierPosts, gatePillars, poses, type Pillar, type Track } from '../../track/schema'
import { buildApron, buildDeck, buildRampSupport, buildTrack, lateralPoint, planDeckPillars, PROFILE, sampleSegment, TRACK_WIDTH, type Band, type SegmentGeometry } from './geometry'

// The Kenney pieces' own material colours (glTF baseColorFactor, linear), so procedural
// segments and glb pieces read as one road; the road itself is the shared ASPHALT.
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
const BAND: Record<Band, THREE.Color> = {
  road: ASPHALT, // look.ts; kenney.ts retints the pieces' own road to match
  curb: linear(0.945, 0.949, 0.965),
  grass: linear(0.302, 0.561, 0.431),
}

/** Shared with the Kenney pieces (kenney.ts), so both kinds of road read equally glossy. */
export const ROAD_ROUGHNESS = 0.7

const roadMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  // Glossy, Trackmania-like: the HDRI environment (scene.ts) gives the clearcoat something to reflect.
  roughness: ROAD_ROUGHNESS,
  // Soft: a sharp coat mirrored the HDRI clouds as blotches across the road.
  clearcoat: 0.15,
  clearcoatRoughness: 0.5,
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
    if (track.segments[i].type === 'gap') return // no road to draw
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

const barrierMaterial = new THREE.MeshStandardMaterial({ color: linear(0.78, 0.1, 0.08), roughness: 0.6 })
const barrierCapMaterial = new THREE.MeshStandardMaterial({ color: linear(0.92, 0.92, 0.9), roughness: 0.6 })
const BARRIER_CAP = 0.25 // m of white along the top

/** Barrier walls and posts from barrierPillars() / barrierPosts() — the same boxes the physics collides with: red walls with a white top, white posts. */
export const createBarriers = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  for (const p of barrierPillars(track)) {
    for (const [mat, y0, h] of [
      [barrierMaterial, 0, p.height - BARRIER_CAP],
      [barrierCapMaterial, p.height - BARRIER_CAP, BARRIER_CAP],
    ] as const) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2 * p.halfWidth, h, 2 * p.halfDepth), mat)
      box.position.set(p.x, p.y + y0 + h / 2, p.z)
      box.rotation.y = p.heading
      box.castShadow = true
      box.receiveShadow = true
      group.add(box)
    }
  }
  for (const p of barrierPosts(track)) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(2 * p.halfWidth, p.height, 2 * p.halfDepth), barrierCapMaterial)
    post.position.set(p.x, p.y + p.height / 2, p.z)
    post.rotation.y = p.heading
    post.castShadow = true
    post.receiveShadow = true
    group.add(post)
  }
  return group
}

/** Concrete for ramp/drop supports: the Kenney curb grey at the top edge, darker at the foot, so the sides read as a solid structure. */
const CONCRETE_TOP = BAND.curb
const CONCRETE_FOOT = linear(0.32, 0.33, 0.36)
const supportMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })
const pillarMaterial = new THREE.MeshStandardMaterial({ color: linear(0.45, 0.46, 0.5), roughness: 0.85 })
/** Pillar spacing along a ramp, and the lowest road height that still gets one. */
const PILLAR_STEP = 5
const PILLAR_MIN_HEIGHT = 0.6
const PILLAR_SIZE = 0.7
/** Deck pillars are heavier: they carry a whole road, not a ramp's edge. */
const DECK_PILLAR_SIZE = 1.6

/** Sides and pillars under every ramp and drop, and decks on pillars under elevated road (visual only; physics drives the road strip). */
export const createRampSupports = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'ramp-supports'
  const ps = poses(track)
  const pillars: THREE.Matrix4[] = []
  track.segments.forEach((seg, i) => {
    const g = buildRampSupport(ps[i], seg)
    if (!g) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1))
    const colors = new Float32Array(g.positions.length)
    for (let r = 0; r < g.rows; r++) {
      ;[CONCRETE_TOP, CONCRETE_FOOT, CONCRETE_TOP, CONCRETE_FOOT].forEach((c, k) => c.toArray(colors, (r * g.perRow + k) * 3))
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const wall = new THREE.Mesh(geo, supportMaterial)
    wall.castShadow = wall.receiveShadow = true
    group.add(wall)
    // Pillars just outside each wall, every PILLAR_STEP metres where the road is high enough.
    const len = (seg as { length: number }).length
    for (let d = PILLAR_STEP / 2; d < len; d += PILLAR_STEP) {
      const p = sampleSegment(ps[i], seg, d / len)
      if (p.y < PILLAR_MIN_HEIGHT) continue
      for (const u of [TRACK_WIDTH / 2 + PILLAR_SIZE / 2, -TRACK_WIDTH / 2 - PILLAR_SIZE / 2]) {
        const [x, , z] = lateralPoint(p, u, 1)
        pillars.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, p.y / 2, z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading),
            new THREE.Vector3(PILLAR_SIZE, p.y, PILLAR_SIZE),
          ),
        )
      }
    }
  })
  // Elevated flat road: a concrete box under the deck, on square pillars that leave underpasses open.
  // Visual only, like the ramp pillars: physics never sees the deck or its pillars.
  track.segments.forEach((seg, i) => {
    const g = buildDeck(ps[i], seg)
    if (!g) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1))
    const colors = new Float32Array(g.positions.length)
    for (let r = 0; r < g.rows; r++) {
      ;[CONCRETE_TOP, CONCRETE_FOOT, CONCRETE_TOP, CONCRETE_FOOT].forEach((c, k) => c.toArray(colors, (r * g.perRow + k) * 3))
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const deck = new THREE.Mesh(geo, supportMaterial)
    deck.castShadow = deck.receiveShadow = true
    group.add(deck)
  })
  for (const p of planDeckPillars(track)) {
    pillars.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.top / 2, p.z),
        new THREE.Quaternion(),
        new THREE.Vector3(DECK_PILLAR_SIZE, p.top, DECK_PILLAR_SIZE),
      ),
    )
  }
  if (pillars.length > 0) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pillarMaterial, pillars.length)
    pillars.forEach((m, k) => mesh.setMatrixAt(k, m))
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
