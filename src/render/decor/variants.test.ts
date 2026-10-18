import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { lintScene } from '../lint'
import { createGenModel, GEN_BUILDINGS, GEN_RADIUS, GEN_TREES, isBuilding, isGen, type GenModel } from './variants'

const ALL: readonly GenModel[] = [...GEN_TREES, ...GEN_BUILDINGS]
const bounds = (m: GenModel) => new THREE.Box3().setFromObject(createGenModel(m))

describe('generated scenery models', () => {
  it('ships at least three tree and three building variants', () => {
    expect(GEN_TREES.length).toBeGreaterThanOrEqual(3)
    expect(GEN_BUILDINGS.length).toBeGreaterThanOrEqual(3)
    expect(ALL.every(isGen)).toBe(true)
    expect(GEN_BUILDINGS.every(isBuilding) && !GEN_TREES.some(isBuilding)).toBe(true)
    expect(isGen('tree_default')).toBe(false)
  })

  for (const m of ALL) {
    it(`${m}: stands on the ground, inside its footprint radius, and passes the scene lint`, () => {
      const b = bounds(m)
      expect(b.min.y).toBeCloseTo(0, 3)
      expect(b.max.y).toBeGreaterThan(4)
      const reach = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)
      expect(reach).toBeLessThanOrEqual(GEN_RADIUS[m])
      const root = new THREE.Group()
      root.add(createGenModel(m))
      expect(lintScene(root).offenders).toEqual([])
    })
  }

  it('gives every variant its own silhouette: no two share height and width within 15%', () => {
    const size = ALL.map((m) => bounds(m).getSize(new THREE.Vector3()))
    for (let i = 0; i < ALL.length; i++) {
      for (let j = i + 1; j < ALL.length; j++) {
        const close = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) < 0.15
        expect(close(size[i].y, size[j].y) && close(size[i].x, size[j].x), `${ALL[i]} vs ${ALL[j]}`).toBe(false)
      }
    }
  })
})
