import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readGlb, type Gltf } from '../assets/glb'
import { poses, validate, type Track } from './schema'

interface PieceSpec {
  cell: number
  pieces: Record<string, { prop?: boolean; footprint?: string }>
  segments: Record<string, string[]>
  gates: Record<string, string>
}

const spec = JSON.parse(readFileSync('assets/track/pieces.json', 'utf8')) as PieceSpec
const load = (name: string) => JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8')) as Track
const lap = load('lap1')
const laps = [lap, load('lap2')]

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

  it('contains a hairpin, a ramp and a banked turn', () => {
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

describe('lap2.json variety', () => {
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

  it('has 4-5 checkpoints', () => {
    const n = lap2.gates.filter((g) => g.kind === 'checkpoint').length
    expect(n).toBeGreaterThanOrEqual(4)
    expect(n).toBeLessThanOrEqual(5)
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
