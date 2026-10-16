import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readGlb, type Gltf } from '../assets/glb'
import { LapLoop } from '../race/lap'
import { planPieces } from '../render/track/kenney-plan'
import { centreline, partialPose, segmentLength } from './centreline'
import { gateLine, poses, START_ARCH_FRACTION, TILE_LENGTH, validate, type Pose, type Track } from './schema'

interface PieceSpec {
  cell: number
  pieces: Record<string, { prop?: boolean; footprint?: string }>
  segments: Record<string, string[]>
  gates: Record<string, string>
}

const spec = JSON.parse(readFileSync('assets/track/pieces.json', 'utf8')) as PieceSpec
const load = (name: string) => JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as Track
const lap = load('test1')
const laps = [lap, load('test2'), load('crossover'), load('tower')]
const flatLaps = laps.slice(0, 2)
const multiLevel = laps.slice(2)

function used(): Set<string> {
  const names = new Set<string>()
  for (const l of laps) {
    for (const seg of l.segments) for (const p of spec.segments[seg.type]) names.add(p)
    for (const g of l.gates) names.add(spec.gates[g.kind])
  }
  return names
}

function bounds(g: Gltf): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of g.meshes) {
    for (const p of mesh.primitives) {
      const a = g.accessors[p.attributes.POSITION]
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min![i])
        max[i] = Math.max(max[i], a.max![i])
      }
    }
  }
  return { min, max }
}

function triangles(g: Gltf): number {
  let n = 0
  for (const mesh of g.meshes) {
    for (const p of mesh.primitives) n += g.accessors[p.indices ?? p.attributes.POSITION].count / 3
  }
  return n
}

describe.each(laps)('$name.json', (lap) => {
  it('validates against the schema', () => {
    expect(validate(lap)).toEqual([])
  })

  it.runIf(flatLaps.includes(lap))('contains a hairpin, a ramp and a banked turn', () => {
    const types = new Set(lap.segments.map((s) => s.type))
    for (const t of ['hairpin', 'ramp', 'banked']) expect(types, t).toContain(t)
  })

  it('has one start/finish gate and at least two checkpoints', () => {
    expect(lap.gates.filter((g) => g.kind === 'start-finish')).toHaveLength(1)
    expect(lap.gates.filter((g) => g.kind === 'checkpoint').length).toBeGreaterThanOrEqual(2)
  })

  it('closes: the last exit pose equals the start pose', () => {
    const all = poses(lap)
    const end = all[all.length - 1]
    expect(Math.hypot(end.x - lap.start.x, end.y - lap.start.y, end.z - lap.start.z)).toBeLessThan(0.01)
    const turn = end.heading - lap.start.heading
    const wrapped = Math.atan2(Math.sin(turn), Math.cos(turn))
    expect(Math.abs(wrapped)).toBeLessThan(0.01)
  })
})

describe('test2.json variety', () => {
  const lap2 = laps[1]
  const count = (type: string) => lap2.segments.filter((s) => s.type === type).length

  it('has two jumps (ramp + drop crests), one longer than lap1', () => {
    const jumps = lap2.segments.filter((s, i) => s.type === 'ramp' && lap2.segments[i + 1]?.type === 'drop')
    expect(jumps).toHaveLength(2)
    expect(Math.max(...jumps.map((s) => (s.type === 'ramp' ? s.length : 0)))).toBeGreaterThan(20)
  })

  it('has a chicane, a fast sweeper, a hairpin and a banked turn', () => {
    expect(lap2.segments.filter((s) => s.type === 'curve' && s.angle === 45).length).toBeGreaterThanOrEqual(4)
    expect(lap2.segments.some((s) => s.type === 'curve' && s.radius >= 25)).toBe(true)
    expect(count('hairpin')).toBeGreaterThanOrEqual(1)
    expect(count('banked')).toBeGreaterThanOrEqual(1)
  })

  it('has at least 5 checkpoints and two sweeper complexes', () => {
    expect(lap2.gates.filter((g) => g.kind === 'checkpoint').length).toBeGreaterThanOrEqual(5)
    expect(lap2.segments.filter((s) => s.type === 'curve' && s.radius >= 30 && s.angle === 45).length).toBeGreaterThanOrEqual(4)
  })
})

// Centreline samples every 2 m, tagged with their segment, for stacking checks.
function samples(track: Track): (Pose & { seg: number })[] {
  const entries = poses(track)
  return track.segments.flatMap((seg, i) => {
    const n = Math.max(1, Math.ceil(segmentLength(seg) / 2))
    return Array.from({ length: n }, (_, k) => ({ ...partialPose(entries[i], seg, k / n), seg: i }))
  })
}

/** Points where one part of the lap passes over another (xz within a road width, height apart). */
function crossings(track: Track, minClear: number): { over: Pose; under: Pose }[] {
  const pts = samples(track)
  const n = track.segments.length
  const out: { over: Pose; under: Pose }[] = []
  for (const a of pts) {
    for (const b of pts) {
      const apart = Math.min(Math.abs(a.seg - b.seg), n - Math.abs(a.seg - b.seg))
      if (apart > 1 && a.y - b.y >= minClear && Math.hypot(a.x - b.x, a.z - b.z) < 5) out.push({ over: a, under: b })
    }
  }
  return out
}

describe.each(multiLevel)('$name.json multi-level', (lap) => {
  it('passes over itself: a bridge at least 7 m above another part of the lap', () => {
    expect(crossings(lap, 7).length).toBeGreaterThan(0)
  })

  it('never stacks two parts of the lap closer than 7 m (no road clipping through another)', () => {
    const pts = samples(lap)
    const n = lap.segments.length
    for (const a of pts) {
      for (const b of pts) {
        const apart = Math.min(Math.abs(a.seg - b.seg), n - Math.abs(a.seg - b.seg))
        if (apart > 1 && Math.hypot(a.x - b.x, a.z - b.z) < 10) expect(Math.abs(a.y - b.y), `seg ${a.seg} vs ${b.seg}`).toBeGreaterThanOrEqual(7)
      }
    }
  })

  it('climbs at least 8 m and comes back down', () => {
    const ys = centreline(lap, 1).map((p) => p.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(8)
  })

  it('keeps every gate clear of the crossing: no other road within 10 m of a gate line', () => {
    const pts = samples(lap)
    const n = lap.segments.length
    lap.gates.forEach((g) => {
      const line = gateLine(lap, g)
      for (const p of pts) {
        const apart = Math.min(Math.abs(p.seg - g.segment), n - Math.abs(p.seg - g.segment))
        if (apart <= 1 || Math.abs(p.y - line.y) < 1) continue
        expect(Math.hypot(p.x - line.x, p.z - line.z), `gate on seg ${g.segment} vs seg ${p.seg}`).toBeGreaterThanOrEqual(9.9)
      }
    })
  })

  // ~8 s at a human lap's ~23 m/s average; the design brief asks for one every 6-10 s.
  it('has a checkpoint at least every 200 m of road', () => {
    const along: number[] = []
    let d = 0
    lap.segments.forEach((seg, i) => {
      if (lap.gates.some((g) => g.segment === i)) along.push(d)
      d += segmentLength(seg)
    })
    along.push(d)
    for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1]).toBeLessThanOrEqual(200)
  })
})

describe('multi-level set pieces', () => {
  it('crossover has a gap jump over air', () => {
    expect(multiLevel[0].segments.some((s) => s.type === 'gap')).toBe(true)
  })
  it('tower has a steep banked 180 (≥ 0.5 rad, twice lap1/lap2) at height', () => {
    const ps = poses(multiLevel[1])
    const i = multiLevel[1].segments.findIndex((s) => s.type === 'banked' && s.angle === 180 && s.bank >= 0.5)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(ps[i].y).toBeGreaterThanOrEqual(8)
  })
})

describe('track pieces', () => {
  const names = [...used()]

  it.each(names)('%s pivots at bottom-center of its entry edge', (name) => {
    const g = readGlb(`assets/pieces/${name}.glb`)
    const b = bounds(g)
    expect(Math.abs(b.min[1])).toBeLessThan(0.001)
    expect(Math.abs(b.min[2])).toBeLessThan(0.001)
    // Entry-edge center: vertices on the z = 0 plane must straddle x = 0 symmetrically.
    expect(b.min[0]).toBeLessThan(0)
    expect(b.max[0]).toBeGreaterThan(0)
  })

  const solid = names.filter((n) => !spec.pieces[n].prop)

  it('has exactly one collision mesh per solid piece used by the laps', () => {
    const files = readdirSync('assets/collision').map((f) => f.replace(/\.glb$/, ''))
    expect(files.filter((f) => solid.includes(f)).sort()).toEqual([...solid].sort())
  })

  it.each(solid)('%s collision mesh is within budget and matches the footprint', (name) => {
    const render = readGlb(`assets/pieces/${spec.pieces[name].footprint ?? name}.glb`)
    const col = readGlb(`assets/collision/${name}.glb`)
    const tris = triangles(col)
    expect(tris).toBeGreaterThanOrEqual(1)
    expect(tris).toBeLessThanOrEqual(2000)
    expect(tris).toBeLessThanOrEqual(triangles(readGlb(`assets/pieces/${name}.glb`)) / 2)
    const rb = bounds(render)
    const cb = bounds(col)
    // Footprint (x, z) within 5% of the render mesh's extent.
    for (const i of [0, 2]) {
      const span = rb.max[i] - rb.min[i]
      expect(Math.abs(cb.min[i] - rb.min[i]), `min[${i}]`).toBeLessThanOrEqual(span * 0.05)
      expect(Math.abs(cb.max[i] - rb.max[i]), `max[${i}]`).toBeLessThanOrEqual(span * 0.05)
    }
  })
})

describe('asset licensing', () => {
  const license = readFileSync('assets/LICENSE', 'utf8')

  function models(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? models(`${dir}/${e.name}`) : e.name.endsWith('.glb') ? [`${dir}/${e.name}`] : [],
    )
  }

  it('lists the pack directory of every model file under assets/', () => {
    for (const f of models('assets')) {
      const dir = f.split('/').slice(0, 2).join('/') + '/'
      expect(license, f).toContain(dir)
    }
  })

  it('mentions no third-party game IP', () => {
    for (const f of models('assets')) expect(f.toLowerCase()).not.toContain('nadeo')
  })
})

// The finish trigger (src/race) and the arch you see (src/render) both come from gateLine();
// this pins gateLine() to where the start model actually draws its banner.
describe('start/finish line', () => {
  // z-centre of the start tile's overhead banner: vertices more than 2 m above the road.
  function bannerZ(path: string): number {
    const buf = readFileSync(path)
    const jsonLen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
      meshes: { primitives: { attributes: { POSITION: number } }[] }[]
      accessors: { bufferView: number; byteOffset?: number; count: number }[]
      bufferViews: { byteOffset?: number; byteStride?: number }[]
    }
    const bin = buf.subarray(20 + jsonLen + 8)
    const zs: number[] = []
    for (const prim of json.meshes[0].primitives) {
      const a = json.accessors[prim.attributes.POSITION]
      const v = json.bufferViews[a.bufferView]
      const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
      const stride = v.byteStride ?? 12
      for (let i = 0; i < a.count; i++) {
        if (bin.readFloatLE(off + i * stride + 4) > 2) zs.push(bin.readFloatLE(off + i * stride + 8))
      }
    }
    return (Math.min(...zs) + Math.max(...zs)) / 2
  }

  it('the start model draws its banner at START_ARCH_FRACTION of the tile', () => {
    expect(Math.abs(bannerZ('assets/pieces/start.glb') - TILE_LENGTH * START_ARCH_FRACTION)).toBeLessThan(1)
  })

  it.each(laps)('$name: the finish trigger sits under the rendered start arch', (lap) => {
    const sf = lap.gates.find((g) => g.kind === 'start-finish')!
    const start = planPieces(lap).placements.find((p) => p.piece === 'start')!
    const line = gateLine(lap, sf)
    const finish = new LapLoop(lap, () => true)['finish'].pose
    expect(finish).toEqual(line)
    const along = (line.x - start.pose.x) * Math.sin(start.pose.heading) + (line.z - start.pose.z) * Math.cos(start.pose.heading)
    expect(Math.abs(along - TILE_LENGTH * start.scale[2] * START_ARCH_FRACTION)).toBeLessThan(1e-9)
  })
})
