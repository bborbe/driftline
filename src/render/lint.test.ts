// The lint's own bite, on hand-built fixtures: each check fails on the broken piece, names it, and
// passes once the piece is fixed. geometry-lint.test.ts runs the same lint over every shipped track.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { closed, CONTACT_TOLERANCE, lintScene, MIN_THICKNESS, thickness } from './lint'
import { flat, noCollide, structural, type FlatReason, type StructuralKind } from './tags'

const box = (name: string, [w, h, d]: [number, number, number], [x, y, z]: [number, number, number]): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d))
  m.name = name
  m.position.set(x, y, z)
  return m
}

/** A single upright sheet, `w` long and `h` tall, standing on y = `foot` at (x, z), facing ±z. */
const sheet = (name: string, w: number, h: number, [x, foot, z]: [number, number, number]): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h))
  m.name = name
  m.position.set(x, foot + h / 2, z)
  return m
}

const scene = (...objs: THREE.Object3D[]) => {
  const root = new THREE.Group()
  root.add(...objs)
  return root
}

const offenders = (root: THREE.Object3D, check: 'thin' | 'floating' | 'tag') =>
  lintScene(root)
    .offenders.filter((o) => o.check === check)
    .map((o) => o.mesh)

describe('thickness', () => {
  it('measures a box by its smallest side, however it is turned', () => {
    const b = new THREE.BoxGeometry(4, 2, 0.3).toNonIndexed().rotateY(0.7)
    const pos = Array.from(b.attributes.position.array)
    expect(thickness(pos, Array.from({ length: pos.length / 3 }, (_, i) => i))).toBeCloseTo(0.3, 3)
  })

  it('reads a sheet as zero thick and open; a box as closed', () => {
    const plane = new THREE.PlaneGeometry(4, 2).rotateY(1.1)
    const pos = Array.from(plane.attributes.position.array)
    const tris = Array.from(plane.index!.array)
    expect(thickness(pos, tris)).toBeLessThan(1e-6)
    expect(closed(tris)).toBe(false)
  })
})

describe('thin check', () => {
  it('fails a deliberately thinned wall and names it; passes the same wall at full thickness', () => {
    expect(offenders(scene(structural(box('thinned-wall', [10, 3, 0.02], [0, 1.5, 0]), 'wall')), 'thin')).toEqual(['thinned-wall'])
    expect(offenders(scene(structural(box('thinned-wall', [10, 3, MIN_THICKNESS + 0.05], [0, 1.5, 0]), 'wall')), 'thin')).toEqual([])
  })

  it('fails a ramp body whose walls end in the air (pre-#86); passes it once end caps close the body', () => {
    // A raised road 3 m up and its body: a wall under each edge, 10 m apart. Without caps, each wall's
    // ends stand free in the air — the sheet shows edge-on as paper.
    const road = () => {
      const r = flat(new THREE.Mesh(new THREE.PlaneGeometry(20, 10).rotateX(-Math.PI / 2)), 'road')
      r.position.y = 3
      return r
    }
    const walls = () => [sheet('wall-left', 20, 3, [0, 0, -5]), sheet('wall-right', 20, 3, [0, 0, 5])]
    const open = new THREE.Group()
    open.name = 'ramp-supports'
    open.add(...walls())
    expect(offenders(scene(road(), structural(open, 'ramp-body')), 'thin').sort()).toEqual(['ramp-supports/wall-left', 'ramp-supports/wall-right'])

    const capped = new THREE.Group()
    capped.name = 'ramp-supports'
    const cap = (x: number) => {
      const c = sheet(`cap${x}`, 10, 3, [x, 0, 0])
      c.rotation.y = Math.PI / 2
      return c
    }
    capped.add(...walls(), cap(-10), cap(10))
    expect(offenders(scene(road(), structural(capped, 'ramp-body')), 'thin')).toEqual([])
  })

  it('exempts a piece tagged flat, and only that piece', () => {
    expect(offenders(scene(flat(sheet('decal', 4, 4, [0, 0, 0]), 'decal'), sheet('untagged', 4, 4, [9, 0, 0])), 'thin')).toEqual(['untagged'])
  })
})

describe('floating check', () => {
  it('fails a floating gate leg and names it; passes it standing on the ground', () => {
    expect(offenders(scene(structural(box('gate-leg', [1, 4, 1], [0, 3, 0]), 'gate-leg')), 'floating')).toEqual(['gate-leg'])
    expect(offenders(scene(structural(box('gate-leg', [1, 4, 1], [0, 2, 0]), 'gate-leg')), 'floating')).toEqual([])
  })

  it('passes a pillar on a deck below it, and fails it once lifted past CONTACT_TOLERANCE', () => {
    const deck = flat(box('road', [10, 0.2, 10], [0, 1.9, 0]), 'road') // top at y 2
    const pillar = (foot: number) => structural(box('pillar', [1, 3, 1], [0, foot + 1.5, 0]), 'pillar')
    expect(offenders(scene(deck.clone(), pillar(2)), 'floating')).toEqual([])
    expect(offenders(scene(deck.clone(), pillar(2 + 2 * CONTACT_TOLERANCE)), 'floating')).toEqual(['pillar'])
  })

  it('carries a board on the posts it touches; fails the board alone', () => {
    const board = () => structural(box('board', [2.6, 1.3, 0.16], [0, 1.25, 0]), 'sign')
    const post = (x: number) => structural(box(`post${x}`, [0.16, 1.9, 0.16], [x, 0.95, -0.16]), 'sign')
    expect(offenders(scene(board(), post(-0.9), post(0.9)), 'floating')).toEqual([])
    expect(offenders(scene(board()), 'floating')).toEqual(['board'])
  })

  it('never lets a load-bearing leg hang off a neighbour: an arch with one leg short fails that leg', () => {
    const arch = scene(
      structural(box('leg-a', [1, 6, 1], [-5, 3, 0]), 'gate-leg'),
      structural(box('leg-b', [1, 4, 1], [5, 4, 0]), 'gate-leg'), // foot 2 m up
      box('beam', [11, 1.2, 1], [0, 6.6, 0]),
    )
    expect(offenders(arch, 'floating')).toEqual(['leg-b'])
  })
})

describe('collider check', () => {
  // A 0.5 × 0.8 × 10 m wall along z at x 0, standing on y 2 (a parapet on a deck).
  const wall = () => structural(box('parapet', [0.5, 0.8, 10], [0, 2.4, 0]), 'wall')
  const collider = { x: 0, y: 2, z: 0, heading: 0, halfWidth: 0.25, halfDepth: 5, height: 0.8 }
  const colliderOffenders = (root: THREE.Object3D, obstacles: { x: number; y: number; z: number; heading: number; halfWidth: number; halfDepth: number; height: number }[]) =>
    lintScene(root, obstacles).offenders.filter((o) => o.check === 'collider').map((o) => o.mesh)

  it('fails a structural part with no collider (the pre-fix parapet) and names it; passes it once its collider is there', () => {
    expect(colliderOffenders(scene(wall()), [])).toEqual(['parapet'])
    expect(colliderOffenders(scene(wall()), [collider])).toEqual([])
  })

  it('fails a collider that covers only part of the mesh, or sits at another height', () => {
    expect(colliderOffenders(scene(wall()), [{ ...collider, halfDepth: 2 }])).toEqual(['parapet'])
    expect(colliderOffenders(scene(wall()), [{ ...collider, y: 10 }])).toEqual(['parapet'])
  })

  it('exempts a part tagged noCollide with a known reason, and counts it; an unknown reason fails the tag check', () => {
    const r = lintScene(scene(noCollide(wall(), 'backdrop')), [])
    expect(r.offenders.filter((o) => o.check === 'collider')).toEqual([])
    expect(r.noCollideByReason).toEqual({ backdrop: 1 })
    expect(offenders(scene(noCollide(wall(), 'nope' as 'backdrop')), 'tag')).toEqual(['parapet'])
  })

  it('needs no collider under a step the wheels climb', () => {
    expect(colliderOffenders(scene(structural(box('foot', [10, 0.2, 2], [0, 0.1, 0]), 'ramp-body')), [])).toEqual([])
  })
})

describe('tags', () => {
  it('fails an unknown reason or kind, and a piece tagged both flat and structural', () => {
    const odd = (name: string) => box(name, [1, 1, 1], [0, 0.5, 0])
    const unknownFlat = odd('unknown-flat')
    unknownFlat.userData.flat = 'just-because' as FlatReason
    const unknownKind = odd('unknown-kind')
    unknownKind.userData.kind = 'tower' as StructuralKind
    const both = structural(flat(odd('both'), 'decal'), 'wall')
    expect(offenders(scene(unknownFlat, unknownKind, both), 'tag')).toEqual(['unknown-flat', 'unknown-kind', 'both'])
  })
})

describe('coverage', () => {
  it('counts every mesh, instanced meshes included, and the structural ones', () => {
    const inst = structural(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), undefined, 3), 'pillar')
    for (let i = 0; i < 3; i++) inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 3, 0.5, 0))
    const r = lintScene(scene(inst, flat(sheet('road', 4, 4, [0, 0, 9]), 'road'), box('rock', [1, 1, 1], [9, 0.5, 9])))
    expect(r.meshes).toBe(3)
    expect(r.structural).toBe(1)
    expect(r.flatByReason).toEqual({ road: 1 })
    expect(r.offenders).toEqual([])
  })
})
