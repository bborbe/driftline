import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { setWetRoad, WET_ROAD } from './view'

const roadGroup = () => {
  const road = new THREE.MeshPhysicalMaterial({ name: 'road', color: 0x808080, roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.4 })
  const kerb = new THREE.MeshStandardMaterial({ name: 'kerb', color: 0xff0000, roughness: 0.6 })
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(), road), new THREE.Mesh(new THREE.BoxGeometry(), road), new THREE.Mesh(new THREE.BoxGeometry(), kerb))
  return { g, road, kerb }
}

describe('setWetRoad (live weather)', () => {
  it('wets the road material once, however many meshes share it, and leaves other materials alone', () => {
    const { g, road, kerb } = roadGroup()
    const dry = road.color.clone()
    setWetRoad(g, true)
    expect(road.roughness).toBe(WET_ROAD.roughness)
    expect(road.clearcoat).toBe(WET_ROAD.clearcoat)
    expect(road.color.r).toBeCloseTo(dry.r * WET_ROAD.darken)
    expect(kerb.roughness).toBe(0.6)
  })
  it('switches back to exactly the dry look, and wetting twice does not darken twice', () => {
    const { g, road } = roadGroup()
    const dry = road.color.clone()
    setWetRoad(g, true)
    setWetRoad(g, true)
    expect(road.color.r).toBeCloseTo(dry.r * WET_ROAD.darken)
    setWetRoad(g, false)
    expect(road.color.getHex()).toBe(dry.getHex())
    expect(road.roughness).toBe(0.6)
    expect(road.clearcoat).toBe(0.3)
    expect(road.clearcoatRoughness).toBe(0.4)
  })
})
