// Scenery collision: every placed scenery object on every shipped track, as an upright box, checked
// against the drivable road's clearance volume and against every other object. Boxes come from the
// same planners the scene draws from (planScenery, planTrackside, planStadium, planSigns, planDressing,
// planDeckPillars, gatePillars / gateLegs); model sizes are read from the glbs themselves.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DECK_PILLAR_SIZE, planDeckPillars } from '../../track/bodies'
import { LAP_NAMES, loadLap } from '../../track/registry'
import { poses, sampleSegment, segmentLength, widthAt, type Track } from '../../track/schema'
import { gateLegs, gatePillars } from '../../track/shapes'
import * as THREE from 'three/webgpu'
import { planScenery, sceneryModels } from '../scenery'
import { resolveTheme } from '../theme'
import { CLOTH, POLE, START_SCREEN, TOTEM, planDressing } from './dressing'
import { BOARD, planSigns } from './signs'
import { SCREEN, planStadium } from './stadium'
import { BANNER, BRAKE_BOARD, CORNER_BOARD, FENCE, MARSHAL } from './trackside'
import { planTrackside, sceneryKeepClear } from './trackside-plan'
import { createGenModel, isGen } from './variants'

/** Road clearance: the road's width plus this much each side, from just under its surface to this high above it. */
const MARGIN = 0.1
const HEADROOM = 6
const BELOW = 0.3
/** Two objects may touch, or overlap by this much, before it counts. */
const TOLERANCE = 0.05

/**
 * An upright box: centred on (x, z) in plan, turned by `heading` (local +z faces it, as placement()
 * in instance.ts), half sizes hx across and hz along, from y0 to y1. `group` ties the parts of one
 * object; `spans` marks the intended spanning objects allowed over the road (the allow-list).
 */
type Box = { what: string; group: string; x: number; z: number; heading: number; hx: number; hz: number; y0: number; y1: number; spans?: boolean }

/** A box whose centre sits at local (lx, lz) of an object at (x, z) turned by `heading`. */
const at = (what: string, x: number, z: number, heading: number, lx: number, lz: number, hx: number, hz: number, y0: number, y1: number, group = what): Box => ({
  what,
  group,
  x: x + lx * Math.cos(heading) + lz * Math.sin(heading),
  z: z - lx * Math.sin(heading) + lz * Math.cos(heading),
  heading,
  hx,
  hz,
  y0,
  y1,
})

/** A glb's bounding box in model units: every mesh node's POSITION accessor min/max, moved by its node chain (translation and scale). */
const bounds = new Map<string, { min: number[]; max: number[] }>()
const glbBounds = (path: string) => {
  const hit = bounds.get(path)
  if (hit) return hit
  const glb = readFileSync(path)
  const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const walk = (n: number, t: number[], s: number[]) => {
    const node = gltf.nodes[n]
    const r = node.rotation ?? [0, 0, 0, 1]
    if (Math.abs(r[3]) < 0.9999) throw new Error(`${path}: node ${n} is rotated`)
    const ns = node.scale ?? [1, 1, 1]
    const nt = (node.translation ?? [0, 0, 0]).map((v: number, k: number) => t[k] + v * s[k])
    const scale = s.map((v, k) => v * ns[k])
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION]
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], nt[k] + acc.min[k] * scale[k])
          max[k] = Math.max(max[k], nt[k] + acc.max[k] * scale[k])
        }
      }
    }
    for (const c of node.children ?? []) walk(c, nt, scale)
  }
  for (const n of gltf.scenes[gltf.scene ?? 0].nodes) walk(n, [0, 0, 0], [1, 1, 1])
  const out = { min, max }
  bounds.set(path, out)
  return out
}

/** A model placed at (x, y, z), turned by `heading`, scaled by `scale`, as one box. */
const modelBox = (what: string, path: string, x: number, y: number, z: number, heading: number, scale: number): Box => {
  const { min, max } = glbBounds(path)
  return at(what, x, z, heading, ((min[0] + max[0]) / 2) * scale, ((min[2] + max[2]) / 2) * scale, ((max[0] - min[0]) / 2) * scale, ((max[2] - min[2]) / 2) * scale, y + min[1] * scale, y + max[1] * scale)
}

const f = (v: number) => v.toFixed(1)

/** A generated model (variants.ts) placed like modelBox, its bounds read from the built model. */
const genBounds = new Map<string, THREE.Box3>()
const genBox = (what: string, model: string, x: number, y: number, z: number, heading: number, scale: number): Box => {
  const b = genBounds.get(model) ?? new THREE.Box3().setFromObject(createGenModel(model as Parameters<typeof createGenModel>[0]))
  genBounds.set(model, b)
  const { min, max } = b
  return at(what, x, z, heading, ((min.x + max.x) / 2) * scale, ((min.z + max.z) / 2) * scale, ((max.x - min.x) / 2) * scale, ((max.z - min.z) / 2) * scale, y + min.y * scale, y + max.y * scale)
}

/** Every scenery object the scene places on `track`, from the same calls createWorld (scene.ts) makes. */
const sceneryBoxes = (track: Track): Box[] => {
  const boxes: Box[] = []
  const trackside = planTrackside(track)
  planScenery(track, 9, 7, sceneryModels(resolveTheme(track).scenery), sceneryKeepClear(track, trackside)).forEach((p, k) => {
    const what = `${p.model}#${k} at ${f(p.x)}, ${f(p.z)}`
    boxes.push(isGen(p.model) ? genBox(what, p.model, p.x, p.y, p.z, p.heading, p.scale) : modelBox(what, `assets/nature-kit/${p.model}.glb`, p.x, p.y, p.z, p.heading, p.scale))
  })
  // Trackside dressing (trackside.ts): panels on posts from the ground just behind them, marshal booths with
  // their flag pole, fence spans.
  const post = 0.16
  trackside.boards.forEach((b, k) => {
    const size = b.kind === 'corner' ? CORNER_BOARD : BRAKE_BOARD
    const back = size.depth + post
    boxes.push(at(`${b.kind} ${b.label}#${k} at ${f(b.x)}, ${f(b.z)}`, b.x, b.z, b.heading, 0, size.depth / 2 - back / 2, size.width / 2, back / 2, Math.min(0, b.y), b.y + size.bottom + size.height))
  })
  trackside.banners.forEach((b, k) => {
    const back = BANNER.depth + post
    boxes.push(at(`banner#${k} at ${f(b.x)}, ${f(b.z)}`, b.x, b.z, b.heading, 0, BANNER.depth / 2 - back / 2, b.length / 2, back / 2, Math.min(0, b.y), b.y + BANNER.bottom + BANNER.height))
  })
  trackside.marshals.forEach((m, k) => {
    const what = `marshal#${k} at ${f(m.x)}, ${f(m.z)}`
    boxes.push(at(`${what} booth`, m.x, m.z, m.heading, 0, 0.2, MARSHAL.width / 2 + 0.3, MARSHAL.depth / 2 + 0.4, 0, MARSHAL.height + 0.3, what))
    boxes.push(at(`${what} flag`, m.x, m.z, m.heading, MARSHAL.width / 2 + 0.85, 0, 0.55, post / 2, 0, MARSHAL.pole, what))
  })
  trackside.fences.forEach((fence, k) => {
    for (let i = 0; i + 1 < fence.points.length; i++) {
      const [x0, z0] = fence.points[i]
      const [x1, z1] = fence.points[i + 1]
      const heading = Math.atan2(-(z1 - z0), x1 - x0)
      boxes.push(at(`fence#${k} span ${i}`, (x0 + x1) / 2, (z0 + z1) / 2, heading, 0, 0, Math.hypot(x1 - x0, z1 - z0) / 2 + post / 2, post / 2, 0, FENCE.height, `fence#${k}`))
    }
  })
  planStadium(track).forEach((p, k) => {
    const what = `stadium ${p.model}#${k} at ${f(p.x)}, ${f(p.z)}`
    // A screen is a board with two legs behind it (stadium.ts screenParts); the rest are Kenney models.
    if (p.model === 'screen') boxes.push(at(what, p.x, p.z, p.heading, 0, -0.55, SCREEN.width / 2, 1.05, 0, SCREEN.bottom + SCREEN.height))
    else boxes.push(modelBox(what, `assets/racing-kit/${p.model}.glb`, p.x, 0, p.z, p.heading, p.scale))
  })
  planSigns(track).forEach((s, k) => {
    // Board and its two posts just behind it (signs.ts createSigns: 0.16 m posts from the ground).
    const back = BOARD.depth + 0.16
    boxes.push(at(`sign ${s.kind}#${k} at ${f(s.x)}, ${f(s.z)}`, s.x, s.z, s.heading, 0, BOARD.depth / 2 - back / 2, BOARD.width / 2, back / 2, Math.min(0, s.y), s.y + BOARD.bottom + BOARD.height))
  })
  planDressing(track).forEach((p, k) => {
    const what = `${p.kind}#${k} at ${f(p.x)}, ${f(p.z)}`
    if (p.kind === 'flag') {
      // Pole, and the cloth hanging off its right (dressing.ts createDressing).
      const right = POLE.size / 2 + CLOTH.width
      boxes.push(at(what, p.x, p.z, p.heading, (right - POLE.size / 2) / 2, 0, (right + POLE.size / 2) / 2, POLE.size / 2, 0, POLE.height))
    } else if (p.kind === 'totem') boxes.push(at(what, p.x, p.z, p.heading, 0, 0, TOTEM.width / 2, TOTEM.depth / 2, 0, TOTEM.height))
    else {
      // Board, then the two legs behind it.
      const S = START_SCREEN
      const back = S.depth / 2 + S.leg
      boxes.push(at(what, p.x, p.z, p.heading, 0, (S.depth / 2 - back) / 2, S.width / 2, (S.depth / 2 + back) / 2, 0, S.bottom + S.height))
    }
  })
  planDeckPillars(track).forEach((p, k) => boxes.push(at(`truss support#${k} at ${f(p.x)}, ${f(p.z)}`, p.x, p.z, 0, 0, 0, DECK_PILLAR_SIZE / 2, DECK_PILLAR_SIZE / 2, 0, p.top)))
  // Arches: pillars, the legs under an elevated one and the beam between them span the road by design.
  track.gates.forEach((g, k) => {
    const group = `${g.kind} arch#${k}`
    const pillars = gatePillars(track, g)
    for (const p of [...pillars, ...gateLegs(track, g)]) boxes.push({ ...at(`${group} pillar`, p.x, p.z, p.heading, 0, 0, p.halfWidth, p.halfDepth, p.y, p.y + p.height, group), spans: true })
    const [a, b] = pillars
    boxes.push({ ...at(`${group} beam`, (a.x + b.x) / 2, (a.z + b.z) / 2, a.heading, 0, 0, Math.hypot(a.x - b.x, a.z - b.z) / 2, a.halfDepth, a.y + a.height - 1, a.y + a.height, group), spans: true })
  })
  return boxes
}

/** The road's clearance volume, one box per metre of drivable road (gaps are open air). */
const clearanceBoxes = (track: Track): Box[] => {
  const ps = poses(track)
  const out: Box[] = []
  track.segments.forEach((seg, i) => {
    if (seg.type === 'gap') return
    const len = segmentLength(seg)
    for (let s = 0; s < len; s += 1) {
      const p = sampleSegment(ps[i], seg, s / len)
      const half = widthAt(seg, s / len) / 2 + MARGIN
      out.push({ what: `road seg ${i} +${f(s)} m (${f(p.x)}, ${f(p.y)}, ${f(p.z)})`, group: 'road', x: p.x, z: p.z, heading: p.heading, hx: half, hz: 0.5, y0: p.y - BELOW, y1: p.y + HEADROOM })
    }
  })
  return out
}

/** Separating-axis test of two boxes in plan, each shrunk by `shrink`, then their height ranges. */
const overlaps = (a: Box, b: Box, shrink: number): boolean => {
  if (a.y0 + shrink >= b.y1 || b.y0 + shrink >= a.y1) return false
  const dx = b.x - a.x
  const dz = b.z - a.z
  const r = a.hx + a.hz + b.hx + b.hz
  if (dx * dx + dz * dz > r * r) return false
  // Each box's local x is (cos h, -sin h), its local z (sin h, cos h): the four candidate axes.
  const extent = (q: Box, ax: number, az: number) =>
    Math.abs(q.hx * (Math.cos(q.heading) * ax - Math.sin(q.heading) * az)) + Math.abs(q.hz * (Math.sin(q.heading) * ax + Math.cos(q.heading) * az))
  for (const h of [a.heading, b.heading]) {
    for (const [ax, az] of [
      [Math.cos(h), -Math.sin(h)],
      [Math.sin(h), Math.cos(h)],
    ]) {
      if (Math.abs(dx * ax + dz * az) >= extent(a, ax, az) + extent(b, ax, az) - 2 * shrink) return false
    }
  }
  return true
}

describe('scenery collision', () => {
  for (const name of LAP_NAMES) {
    const track = loadLap(name)
    const boxes = sceneryBoxes(track)

    it(`${name}: no scenery object stands in the road's clearance (allow-list: arches)`, () => {
      const road = clearanceBoxes(track)
      const hits: string[] = []
      for (const b of boxes) {
        if (b.spans) continue
        const r = road.find((c) => overlaps(b, c, 0))
        if (r) hits.push(`${b.what} (y ${f(b.y0)}..${f(b.y1)}) in ${r.what}`)
      }
      expect(hits).toEqual([])
    })

    it(`${name}: no two scenery objects overlap`, () => {
      const hits: string[] = []
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) if (boxes[i].group !== boxes[j].group && overlaps(boxes[i], boxes[j], TOLERANCE)) hits.push(`${boxes[i].what} × ${boxes[j].what}`)
      expect(hits).toEqual([])
    })
  }
})
