import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { lintScene } from '../lint'
import { atlasCell, createTrackside, MAX_CORNER_LABEL, type TracksidePlan } from './trackside'

beforeAll(() => {
  // Canvas-drawn atlas: headless, a no-op 2D context (as geometry-lint.test.ts).
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true })
  const g = globalThis as Record<string, unknown>
  g.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
})

const PLAN: TracksidePlan = {
  boards: [
    { kind: 'brake-100', label: 100, x: 0, y: 0, z: 0, heading: 0 },
    { kind: 'brake-50', label: 50, x: 5, y: 0, z: 0, heading: 0.4 },
    { kind: 'corner', label: 3, x: 10, y: 0, z: 0, heading: Math.PI },
  ],
  banners: [{ variant: 1, x: 0, y: 0, z: 10, heading: 0.2, length: 8 }],
  marshals: [{ x: 20, y: 0, z: 0, heading: 1 }],
  fences: [{ y: 0, points: [[0, 20], [6, 21], [12, 24]] }],
  patches: [{ x: 30, z: 0, radius: 4, heading: 0.3, shade: 'dirt' }],
}

describe('trackside atlas', () => {
  it('has a distinct cell for every face it prints', () => {
    const faces = [
      { kind: 'brake-100', label: 100 },
      { kind: 'brake-50', label: 50 },
      { kind: 'banner', label: 0 },
      { kind: 'banner', label: 1 },
      ...Array.from({ length: MAX_CORNER_LABEL }, (_, i) => ({ kind: 'corner' as const, label: i + 1 })),
    ] as const
    const cells = faces.map((f) => atlasCell(f))
    expect(cells.every((c) => c !== undefined)).toBe(true)
    expect(new Set(cells.map((c) => c!.join(','))).size).toBe(faces.length)
  })

  it('has no cell for a corner it does not print', () => {
    expect(atlasCell({ kind: 'corner', label: 0 })).toBeUndefined()
    expect(atlasCell({ kind: 'corner', label: MAX_CORNER_LABEL + 1 })).toBeUndefined()
  })
})

describe('createTrackside', () => {
  it('builds boards, structures and patches that pass the scene lint', () => {
    const root = new THREE.Group()
    const group = createTrackside(PLAN)
    root.add(group)
    expect(group.children.map((c) => c.name).sort()).toEqual(['terrain-patches', 'trackside-boards', 'trackside-structures'])
    expect(lintScene(root).offenders).toEqual([])
  })

  it('builds nothing from an empty plan', () => {
    expect(createTrackside({ boards: [], banners: [], marshals: [], fences: [], patches: [] }).children).toEqual([])
  })
})
