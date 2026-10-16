// Builds normalized track pieces from the Kenney Racing Kit plus generated pieces.
//   assets/pieces/<name>.glb     render mesh: scaled to metres, entry edge
//                                bottom-center at the origin, piece runs along +z
//   assets/collision/<name>.glb  smooth collision surface generated from the piece's
//                                `surface` in pieces.json (props have none)
// Run: node scripts/build-pieces.mjs   (deterministic; re-run after editing pieces.json)
import { mkdirSync, readFileSync } from 'node:fs'
import { Document, NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { clearNodeTransform, transformMesh } from '@gltf-transform/functions'

const spec = JSON.parse(readFileSync('assets/track/pieces.json', 'utf8'))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const EDGE_EPS = 0.01
// Generated render meshes are drawn finer than their colliders.
const RENDER_STEPS = 32
const COLLISION_STEPS = 16

mkdirSync('assets/pieces', { recursive: true })
mkdirSync('assets/collision', { recursive: true })

for (const [name, piece] of Object.entries(spec.pieces)) {
  let doc
  if (piece.generated) {
    doc = surfaceDoc(name, piece.surface, RENDER_STEPS)
  } else {
    doc = await io.read(`assets/${piece.source}`)
    normalize(doc, spec.cell)
  }
  await io.write(`assets/pieces/${name}.glb`, doc)
  if (piece.prop) continue
  await io.write(`assets/collision/${name}.glb`, surfaceDoc(name, piece.surface, COLLISION_STEPS))
}

/** Bake node transforms, scale to metres, rotate so the piece runs along +z, move the entry edge center to the origin. */
function normalize(doc, scale) {
  const scene = doc.getRoot().listScenes()[0]
  for (const node of doc.getRoot().listNodes()) clearNodeTransform(node)
  // Kenney pieces run along -z; a 180° turn about y makes them run along +z.
  const rot = [-scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, -scale, 0, 0, 0, 0, 1]
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, rot)
  const b = getBounds(scene)
  const edge = entryEdgeX(doc, b.min[2])
  const move = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -edge, -b.min[1], -b.min[2], 1]
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, move)
}

/** Center x of the vertices lying on the entry edge (the minimum-z plane). */
function entryEdgeX(doc, minZ) {
  let lo = Infinity
  let hi = -Infinity
  const v = [0, 0, 0]
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v)
        if (Math.abs(v[2] - minZ) < EDGE_EPS) {
          lo = Math.min(lo, v[0])
          hi = Math.max(hi, v[0])
        }
      }
    }
  }
  return (lo + hi) / 2
}

/**
 * Road band one cell wide, as a triangle strip.
 * strip: runs along +z for `length`, rising linearly by `rise`.
 * arc:   right-hand turn of `radius` (centre on -x, matching src/track/schema.ts),
 *        outer edge raised by the `bank` angle.
 */
function surfaceDoc(name, surface, steps) {
  const half = spec.cell / 2
  const pos = []
  const idx = []
  const n = surface.kind === 'strip' ? 1 : steps
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (surface.kind === 'strip') {
      const z = surface.length * t
      const y = surface.rise * t
      pos.push(-half, y, z, half, y, z)
    } else {
      const a = ((surface.angle * Math.PI) / 180) * t
      const cx = -surface.radius
      const rIn = surface.radius - half
      const rOut = surface.radius + half
      pos.push(cx + rIn * Math.cos(a), 0, rIn * Math.sin(a))
      pos.push(cx + rOut * Math.cos(a), Math.tan(surface.bank) * spec.cell, rOut * Math.sin(a))
    }
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  const doc = new Document()
  const buf = doc.createBuffer()
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
  doc.createScene().addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)))
  return doc
}
