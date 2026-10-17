// three.js wrapper around the pure track geometry: one mesh per segment plus gate arches.
import * as THREE from 'three/webgpu'
import { ASPHALT } from '../look'
import { flat, structural, type StructuralKind } from '../tags'
import { barrierPillars, barrierPosts, gatePillars, poses, type Pillar, type Track } from '../../track/schema'
import { buildApron, buildBody, buildDeck, buildTrack, planBodies, planDeckPillars, planGateFootings, PROFILE, type Band, type SegmentGeometry } from './geometry'

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
    const pillar = structural(new THREE.Mesh(new THREE.BoxGeometry(2 * p.halfWidth, p.height, 2 * p.halfDepth), mat), 'gate-leg')
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
    const mesh = flat(new THREE.Mesh(toBufferGeometry(g), roadMaterial), 'road')
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
      const verge = flat(new THREE.Mesh(geo, vergeMaterial), 'road')
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
      const box = structural(new THREE.Mesh(new THREE.BoxGeometry(2 * p.halfWidth, h, 2 * p.halfDepth), mat), 'wall')
      box.position.set(p.x, p.y + y0 + h / 2, p.z)
      box.rotation.y = p.heading
      box.castShadow = true
      box.receiveShadow = true
      group.add(box)
    }
  }
  for (const p of barrierPosts(track)) {
    const post = structural(new THREE.Mesh(new THREE.BoxGeometry(2 * p.halfWidth, p.height, 2 * p.halfDepth), barrierCapMaterial), 'wall')
    post.position.set(p.x, p.y + p.height / 2, p.z)
    post.rotation.y = p.heading
    post.castShadow = true
    post.receiveShadow = true
    group.add(post)
  }
  return group
}

/** Concrete for raised bodies and decks: the Kenney curb grey at the top edge, darker at the foot, so the sides read as a solid structure. */
const CONCRETE_TOP = BAND.curb
const CONCRETE_FOOT = linear(0.32, 0.33, 0.36)
// Pushed back in depth: where a banked turn's verge skirt (buildApron) shares a body wall's plane, the skirt draws, not a z-fight.
const supportMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
const pillarMaterial = new THREE.MeshStandardMaterial({ color: linear(0.45, 0.46, 0.5), roughness: 0.85 })
/** Deck pillars carry a whole road. */
const DECK_PILLAR_SIZE = 1.6

const concreteMesh = (g: SegmentGeometry, foot: (vertex: number) => boolean, kind: StructuralKind): THREE.Mesh => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1))
  const colors = new Float32Array(g.positions.length)
  for (let v = 0; v < g.positions.length / 3; v++) (foot(v) ? CONCRETE_FOOT : CONCRETE_TOP).toArray(colors, v * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mesh = structural(new THREE.Mesh(geo, supportMaterial), kind)
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

/**
 * Solid bodies down to the ground under every raised row (ramps, drops, raised road), a deck box
 * on pillars only where another road passes underneath (planBodies), and footings under elevated
 * gates. Visual only: physics drives the road strip and never sees any of them.
 */
export const createRampSupports = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'ramp-supports'
  const ps = poses(track)
  const plans = planBodies(track)
  const pillars: THREE.Matrix4[] = []
  track.segments.forEach((seg, i) => {
    const plan = plans[i]
    if (plan) {
      const body = buildBody(ps[i], seg, plan)
      if (body.indices.length > 0) group.add(concreteMesh(body, (v) => body.positions[v * 3 + 1] === 0, 'ramp-body'))
    }
    const deck = buildDeck(ps[i], seg, plan?.kinds ?? null)
    if (deck) group.add(concreteMesh(deck, (v) => v % deck.perRow === 1 || v % deck.perRow === 3, 'deck'))
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
  // Gate legs on an elevated deck stand beside the road, clear of the deck box: carry each to the ground.
  for (const f of planGateFootings(track)) {
    pillars.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(f.x, f.height / 2, f.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading),
        new THREE.Vector3(2 * f.halfWidth, f.height, 2 * f.halfDepth),
      ),
    )
  }
  if (pillars.length > 0) {
    const mesh = structural(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pillarMaterial, pillars.length), 'pillar')
    pillars.forEach((m, k) => mesh.setMatrixAt(k, m))
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
