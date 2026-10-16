import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { preparePiece } from './kenney'

describe('Kenney piece preparation', () => {
  it('makes every material double-sided so elevated pieces are solid from below', () => {
    const root = new THREE.Group()
    const single = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()])
    root.add(single, multi)
    preparePiece(root)
    expect((single.material as THREE.Material).side).toBe(THREE.DoubleSide)
    for (const m of multi.material as THREE.Material[]) expect(m.side).toBe(THREE.DoubleSide)
    expect(single.castShadow).toBe(true)
  })
})
