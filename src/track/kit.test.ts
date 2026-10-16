import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { trackSurface } from '../physics'
import { buildDeck, DECK_MIN_HEIGHT, lateralPoint, planDeckPillars, PROFILE, sampleSegment } from '../render/track/geometry'
import { compileKit, connectorPose, isKitTrack, KIT_PIECES, LEVEL, onGrid, outConnector, resolveTrack, type KitTrack, type PieceDef } from './kit'
import { CELL, exitPose, poses, validate, type Pose, type Segment, type Turn } from './schema'

const EPS = 1e-6
const turnsOf = (def: PieceDef): Turn[] => (def.turns ? ['left', 'right'] : ['left'])
const turnSign = (seg: Segment): number => ('turn' in seg && seg.turn === 'right' ? -1 : 1)

/** Geometric exit of a piece: its expanded segments chained through schema exitPose. */
const geometricExit = (entry: Pose, def: PieceDef, turn: Turn): Pose =>
  def.expand(turn).segments.reduce((p, seg) => exitPose(p, seg), entry)

const expectPose = (a: Pose, b: Pose) => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(EPS)
  expect(Math.abs(a.y - b.y)).toBeLessThan(EPS)
  expect(Math.abs(a.z - b.z)).toBeLessThan(EPS)
  expect(Math.abs(a.heading - b.heading)).toBeLessThan(EPS)
}

/** Every rendered cross-section point (PROFILE columns, heights included) at one end of a piece. */
const edgePoints = (entry: Pose, def: PieceDef, turn: Turn, end: 'entry' | 'exit'): [number, number, number][] => {
  const segs = def.expand(turn).segments
  let p = entry
  for (let i = 0; i < segs.length - 1; i++) p = exitPose(p, segs[i])
  const seg = end === 'entry' ? segs[0] : segs[segs.length - 1]
  const at = end === 'entry' ? entry : p
  const sample = sampleSegment(at, seg, end === 'entry' ? 0 : 1)
  return PROFILE.map(([u, h]) => {
    const [x, y, z] = lateralPoint(sample, u, turnSign(seg))
    return [x, y + h, z]
  })
}

describe('track piece kit', () => {
  it('has at least 10 piece types with unique ids', () => {
    expect(KIT_PIECES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(KIT_PIECES.map((p) => p.id)).size).toBe(KIT_PIECES.length)
  })

  it('(a) every piece × 4 headings: declared out-connector equals the geometric exit and lies on the grid', () => {
    let checked = 0
    for (const def of KIT_PIECES) {
      for (const turn of turnsOf(def)) {
        for (let dir = 0; dir < 4; dir++) {
          const entry: Pose = { x: 3 * CELL, y: LEVEL, z: -2 * CELL, heading: (dir * Math.PI) / 2 }
          const declared = connectorPose(entry, outConnector(def, turn))
          expectPose(geometricExit(entry, def, turn), declared)
          expect(onGrid(declared)).toBe(true)
          expect(outConnector(def, turn).bank).toBe(0)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(KIT_PIECES.length * 4)
  })

  it('(a) curve family exits at independently known offsets (90° left at r = 10 → forward 10, left 10, +90°)', () => {
    const origin: Pose = { x: 0, y: 0, z: 0, heading: 0 }
    const r1 = KIT_PIECES.find((p) => p.id === 'curve-r1')!
    // Heading 0 travels +z; its left side is +x.
    expectPose(geometricExit(origin, r1, 'left'), { x: 10, y: 0, z: 10, heading: Math.PI / 2 })
    expectPose(geometricExit(origin, r1, 'right'), { x: -10, y: 0, z: 10, heading: -Math.PI / 2 })
    const r3 = KIT_PIECES.find((p) => p.id === 'curve-r3')!
    expectPose(geometricExit(origin, r3, 'left'), { x: 30, y: 0, z: 30, heading: Math.PI / 2 })
    const up = KIT_PIECES.find((p) => p.id === 'slope-up')!
    expectPose(geometricExit(origin, up, 'left'), { x: 0, y: LEVEL, z: 20, heading: 0 })
  })

  it('(b) all n² ordered piece pairs join with 0 gap and 0 step across the whole rendered road', () => {
    let pairs = 0
    for (const a of KIT_PIECES) {
      for (const b of KIT_PIECES) {
        const origin: Pose = { x: 0, y: 0, z: 0, heading: 0 }
        const join = connectorPose(origin, outConnector(a, 'left'))
        const aEnd = edgePoints(origin, a, 'left', 'exit')
        const bStart = edgePoints(join, b, 'left', 'entry')
        aEnd.forEach((p, k) => {
          const q = bStart[k]
          expect(Math.hypot(p[0] - q[0], p[2] - q[2]), `${a.id} → ${b.id} gap at column ${k}`).toBeLessThan(EPS)
          expect(Math.abs(p[1] - q[1]), `${a.id} → ${b.id} step at column ${k}`).toBeLessThan(EPS)
        })
        pairs++
      }
    }
    expect(pairs).toBe(KIT_PIECES.length ** 2)
  })

  it('(c) physics surface height equals the rendered road height on every piece (centreline and road edges)', () => {
    const road = PROFILE.filter(([, , band]) => band === 'road').map(([u]) => u)
    const offsets = [0, Math.max(...road), Math.min(...road)]
    for (const def of KIT_PIECES) {
      for (const turn of turnsOf(def)) {
        const entry: Pose = { x: 0, y: LEVEL, z: 0, heading: Math.PI / 2 }
        const segments = def.expand(turn).segments
        const surface = trackSurface({ name: def.id, start: entry, segments, gates: [] }, { groundY: null })
        let p = entry
        for (const seg of segments) {
          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            // Ends nudged inside the piece: exactly on the joint an arc's sweep test can wrap to 2π.
            const s = sampleSegment(p, seg, Math.min(1 - 1e-7, Math.max(1e-7, t)))
            for (const u of offsets) {
              const [x, y, z] = lateralPoint(s, u, turnSign(seg))
              const hit = surface.raycast({ x, y: y + 2, z }, { x: 0, y: -1, z: 0 }, 10)
              expect(hit, `${def.id} ${turn} t=${t} u=${u}: no physics surface`).not.toBeNull()
              expect(Math.abs(y + 2 - hit!.distance - y), `${def.id} ${turn} t=${t} u=${u}`).toBeLessThan(1e-3)
            }
          }
          p = exitPose(p, seg)
        }
      }
    }
  })
})

describe('compileKit', () => {
  const loop = (pieces: KitTrack['kit']['pieces']): KitTrack => ({ name: 'kit-test', kit: { start: { cell: [0, 0], level: 0, dir: 0 }, pieces } })

  it('compiles a closed loop to a plain Track with gates, zones and barriers', () => {
    const { track } = compileKit(
      loop([
        { piece: 'start' },
        { piece: 'turbo' },
        { piece: 'walled', surface: 'dirt' },
        { piece: 'bank-180', turn: 'right' },
        { piece: 'checkpoint' },
        { piece: 'straight-2' },
        { piece: 'straight-1', surface: 'ice' },
        { piece: 'straight-1' },
        { piece: 'curve-r2', turn: 'right' },
        { piece: 'curve-r2', turn: 'right' },
      ]),
    )
    expect(track.gates.map((g) => g.kind)).toEqual(['start-finish', 'checkpoint'])
    expect(track.zones?.map((z) => z.kind)).toEqual(['turbo', 'dirt', 'ice'])
    expect(track.barriers).toHaveLength(2)
  })

  it('refuses a lap that does not close', () => {
    expect(() => compileKit(loop([{ piece: 'start' }, { piece: 'curve-r1' }]))).toThrow(/does not close/)
  })

  it('refuses unknown pieces, surfaces a piece lacks, and walls above ground', () => {
    expect(() => compileKit(loop([{ piece: 'loop' }]))).toThrow(/unknown piece/)
    expect(() => compileKit(loop([{ piece: 'curve-r1', surface: 'ice' }]))).toThrow(/no ice variant/)
    expect(() => compileKit(loop([{ piece: 'slope-up' }, { piece: 'walled' }]))).toThrow(/ground only/)
  })
})

describe('kit level format', () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../assets/track/${name}.json`, import.meta.url), 'utf8')) as unknown
  const shipped = readdirSync(new URL('../../assets/track/', import.meta.url))
    .filter((f) => f.endsWith('.json') && f !== 'pieces.json')
    .map((f) => f.slice(0, -'.json'.length))

  it('every shipped track loads: kit tracks compile and validate, spline tracks pass through unchanged', () => {
    const kits = shipped.filter((n) => isKitTrack(read(n)))
    expect(kits).toContain('test-kit')
    for (const name of shipped) {
      const raw = read(name)
      const track = resolveTrack(raw)
      expect(validate(track), name).toEqual([])
      if (!isKitTrack(raw)) expect(track, name).toBe(raw)
    }
    for (const spline of ['test1', 'test2', 'crossover', 'tower']) expect(isKitTrack(read(spline)), spline).toBe(false)
  })

  it('test-kit-all.json uses every kit piece type (the docs/track-kit.md catalogue track)', () => {
    const used = new Set((read('test-kit-all') as KitTrack).kit.pieces.map((p) => p.piece))
    expect([...used].sort()).toEqual(KIT_PIECES.map((p) => p.id).sort())
  })

  describe('test-kit.json demo', () => {
    const kt = read('test-kit') as KitTrack
    const { track, firstSegment } = compileKit(kt)
    const ps = poses(track)

    it('uses at least 8 piece types, including a curve, both slopes, a bank, a turbo, a checkpoint and the start', () => {
      const used = new Set(kt.kit.pieces.map((p) => p.piece))
      expect(used.size).toBeGreaterThanOrEqual(8)
      const family = (id: string) => KIT_PIECES.find((p) => p.id === id)!.family
      expect([...used].some((id) => family(id) === 'curve')).toBe(true)
      for (const id of ['slope-up', 'slope-down', 'turbo', 'checkpoint', 'start']) expect(used, id).toContain(id)
      expect([...used].some((id) => family(id) === 'bank')).toBe(true)
    })

    it('has an elevated section at least 7 m up', () => {
      expect(Math.max(...ps.map((p) => p.y))).toBeGreaterThanOrEqual(7)
    })

    it('every flat piece at or above DECK_MIN_HEIGHT (1 m) renders a deck whose soffit faces down', () => {
      expect(DECK_MIN_HEIGHT).toBe(1)
      const elevated = track.segments.map((seg, i) => ({ seg, entry: ps[i] })).filter(({ seg, entry }) => entry.y >= DECK_MIN_HEIGHT && seg.type !== 'ramp' && seg.type !== 'drop' && seg.type !== 'gap')
      expect(elevated.length).toBeGreaterThanOrEqual(1)
      for (const { seg, entry } of elevated) {
        const g = buildDeck(entry, seg)
        expect(g, seg.type).not.toBeNull()
        expect(g!.positions.length).toBeGreaterThan(0)
        // Soffit triangles join the two foot vertices (row offsets 1 and 3) of consecutive rows.
        const v = (i: number) => [g!.positions[3 * i], g!.positions[3 * i + 1], g!.positions[3 * i + 2]]
        let soffits = 0
        for (let t = 0; t < g!.indices.length; t += 3) {
          const [a, b, c] = [g!.indices[t], g!.indices[t + 1], g!.indices[t + 2]]
          if (![a, b, c].every((i) => i % g!.perRow === 1 || i % g!.perRow === 3)) continue
          const [p, q, r] = [v(a), v(b), v(c)]
          const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
          const w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
          const ny = u[2] * w[0] - u[0] * w[2]
          expect(ny, `${seg.type} soffit normal`).toBeLessThan(0)
          soffits++
        }
        expect(soffits).toBeGreaterThan(0)
      }
    })

    it('every elevated straight of at least 12 m stands on at least one pillar', () => {
      const pillars = planDeckPillars(track)
      const decks = track.segments
        .map((seg, i) => ({ seg, entry: ps[i] }))
        .filter(({ seg, entry }) => seg.type === 'straight' && seg.length >= 12 && entry.y >= DECK_MIN_HEIGHT)
      expect(decks.length).toBeGreaterThanOrEqual(1)
      for (const { seg, entry } of decks) {
        const len = (seg as { length: number }).length
        const under = pillars.filter((p) => {
          const u = (p.x - entry.x) * Math.sin(entry.heading) + (p.z - entry.z) * Math.cos(entry.heading)
          const lat = (p.x - entry.x) * Math.cos(entry.heading) - (p.z - entry.z) * Math.sin(entry.heading)
          return u >= 0 && u <= len && Math.abs(lat) < 1e-6
        })
        expect(under.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('places pieces on the grid and records each piece start', () => {
      expect(firstSegment).toHaveLength(kt.kit.pieces.length)
      for (const i of firstSegment) expect(onGrid(ps[i])).toBe(true)
    })
  })
})
