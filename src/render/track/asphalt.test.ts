import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { ASPHALT_LANE, ASPHALT_MASK, ASPHALT_TEXELS, asphaltRoughness, asphaltShade, asphaltTexels, GRAIN, WHEEL_TRACK, wheelTrackWear } from './asphalt'
import { createTrackMesh, ROAD_ROUGHNESS } from './mesh'
import { PROFILE } from './geometry'
import { loadLap } from '../../track/registry'

// Rain's roughness for wet asphalt (the weather worker's WET_ROAD in view.ts); the asphalt must still vary on top of it.
const WET_ROUGHNESS = 0.22

const channel = (texels: Uint8Array, c: number) => Array.from({ length: texels.length / 4 }, (_, i) => texels[4 * i + c])
const stddev = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}

describe('asphalt texture', () => {
  it('is deterministic: two generations are byte-identical', () => {
    expect(asphaltTexels()).toEqual(asphaltTexels())
  })

  it('has real contrast in grain and wear, and a sprinkle of stones', () => {
    const t = asphaltTexels()
    expect(t.length).toBe(ASPHALT_TEXELS * ASPHALT_TEXELS * 4)
    expect(stddev(channel(t, 0))).toBeGreaterThan(20) // grain, 0..255
    expect(stddev(channel(t, 1))).toBeGreaterThan(10) // wear
    const stones = channel(t, 2).filter((b) => b === 255).length / (ASPHALT_TEXELS * ASPHALT_TEXELS)
    expect(stones).toBeGreaterThan(0.005)
    expect(stones).toBeLessThan(0.03)
  })

  it('tiles: the wrap-around step is no larger than an ordinary step in the coarse layers', () => {
    const t = asphaltTexels()
    const at = (x: number, y: number, c: number) => t[4 * (y * ASPHALT_TEXELS + x) + c]
    let wrap = 0
    let inner = 0
    for (let y = 0; y < ASPHALT_TEXELS; y++) {
      wrap = Math.max(wrap, Math.abs(at(ASPHALT_TEXELS - 1, y, 1) - at(0, y, 1)))
      inner = Math.max(inner, Math.abs(at(1, y, 1) - at(0, y, 1)))
    }
    expect(wrap).toBeLessThanOrEqual(inner + 1)
  })

  it('shades the colour by ±GRAIN around the material colour, darker where worn', () => {
    expect(asphaltShade(0, 0, 0)).toBeCloseTo(1 - GRAIN, 6)
    expect(asphaltShade(1, 0, 0)).toBeCloseTo(1 + GRAIN, 6)
    expect(asphaltShade(0.5, 1, 0)).toBeLessThan(asphaltShade(0.5, 0, 0))
    expect(asphaltShade(0.5, 0, 1)).toBeGreaterThan(asphaltShade(0.5, 0, 0))
  })
})

describe('asphalt sheen', () => {
  const lanes = Array.from({ length: 71 }, (_, i) => -3.45 + (6.9 * i) / 70)

  it('wheel tracks are worn and the centre line is not', () => {
    expect(wheelTrackWear(WHEEL_TRACK)).toBeCloseTo(1, 6)
    expect(wheelTrackWear(-WHEEL_TRACK)).toBeCloseTo(1, 6)
    expect(wheelTrackWear(0)).toBeLessThan(0.01)
  })

  for (const [name, base] of [['dry', ROAD_ROUGHNESS], ['wet', WET_ROUGHNESS]] as const) {
    it(`${name}: roughness varies across the road by ≥ 0.05, glossier in the wheel tracks than on the centre line`, () => {
      const r = lanes.map((u) => asphaltRoughness(base, wheelTrackWear(u)))
      if (name === 'wet') expect(Math.max(...r)).toBeLessThan(ROAD_ROUGHNESS) // rain still glosses the asphalt
      expect(Math.max(...r) - Math.min(...r)).toBeGreaterThanOrEqual(0.05)
      expect(asphaltRoughness(base, wheelTrackWear(WHEEL_TRACK))).toBeLessThan(asphaltRoughness(base, wheelTrackWear(0)))
    })
  }

  it('wet roughness is the dry formula on the wet base: rain scales it, asphalt never overrides it', () => {
    for (const wear of [0, 0.5, 1]) {
      expect(asphaltRoughness(WET_ROUGHNESS, wear) / asphaltRoughness(ROAD_ROUGHNESS, wear)).toBeCloseTo(WET_ROUGHNESS / ROAD_ROUGHNESS, 6)
    }
  })
})

describe('asphalt on the procedural road', () => {
  const roads = () => {
    const out: THREE.Mesh[] = []
    createTrackMesh(loadLap('test1')).traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.geometry.getAttribute(ASPHALT_MASK)) out.push(m)
    })
    return out
  }

  it('masks exactly the asphalt columns and records each column’s lateral offset', () => {
    const meshes = roads()
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) {
      const mask = mesh.geometry.getAttribute(ASPHALT_MASK)
      const lane = mesh.geometry.getAttribute(ASPHALT_LANE)
      for (let v = 0; v < mask.count; v++) {
        const c = v % PROFILE.length
        expect(mask.getX(v)).toBe(PROFILE[c][2] === 'road' ? 1 : 0)
        expect(lane.getX(v)).toBeCloseTo(PROFILE[c][0], 6)
      }
    }
  })

  it('layers its nodes over the material uniforms (colorNode, roughnessNode set; colour and roughness untouched)', () => {
    const mat = roads()[0].material as THREE.MeshPhysicalMaterial & { colorNode: unknown; roughnessNode: unknown }
    expect(mat.colorNode).toBeTruthy()
    expect(mat.roughnessNode).toBeTruthy()
    expect(mat.roughness).toBe(ROAD_ROUGHNESS)
  })
})
