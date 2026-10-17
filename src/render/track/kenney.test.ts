import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { resolveTrack } from '../../track/kit'
import type { Track } from '../../track/schema'
import { createGateLegs, preparePiece } from './kenney'
import { CHECKPOINT_LEG, planGateLegs, planPieces } from './kenney-plan'
import { createRampSupports } from './mesh'

describe('Kenney piece preparation', () => {
  it('makes every material double-sided so elevated pieces are solid from below', () => {
    const root = new THREE.Group()
    const single = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()])
    root.add(single, multi)
    preparePiece(root)
    expect((single.material as THREE.Material).side).toBe(THREE.DoubleSide)
    for (const m of multi.material as THREE.Material[]) expect(m.side).toBe(THREE.DoubleSide)
    expect((single.material as THREE.Material).shadowSide).toBe(THREE.BackSide)
    expect(single.castShadow).toBe(true)
  })
})

describe('elevated gate legs', () => {
  const load = (name: string) => resolveTrack(JSON.parse(readFileSync(`assets/track/${name}.json`, 'utf8'))) as Track
  const checkpoint = async () => {
    const buf = readFileSync('assets/pieces/checkpoint.glb')
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
    return preparePiece(gltf.scene)
  }

  it('measures CHECKPOINT_LEG from the checkpoint piece itself', async () => {
    const legBase: THREE.Vector3[] = []
    ;(await checkpoint()).traverse((o) => {
      const pos = (o as THREE.Mesh).geometry?.getAttribute('position')
      if (!pos) return
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) === 0 && pos.getX(i) > 0) legBase.push(new THREE.Vector3().fromBufferAttribute(pos, i))
    })
    const xs = legBase.map((v) => v.x)
    const zs = legBase.map((v) => v.z)
    expect(Math.min(...xs)).toBeCloseTo(CHECKPOINT_LEG.inner, 5)
    expect(Math.max(...xs)).toBeCloseTo(CHECKPOINT_LEG.outer, 5)
    expect(Math.min(...zs)).toBeCloseTo(0, 5)
    expect(Math.max(...zs)).toBeCloseTo(CHECKPOINT_LEG.depth, 5)
  })

  it('draws the legs under an elevated gate in the checkpoint piece\'s own material, not concrete', async () => {
    const model = await checkpoint()
    let material: THREE.Material | undefined
    model.traverse((o) => (material ??= (o as THREE.Mesh).material as THREE.Material))
    const track = load('crossover')
    const legs = createGateLegs(planGateLegs(planPieces(track)), model)
    expect(legs.children.length).toBe(4) // crossover CP 1 and CP 2, two legs each
    for (const leg of legs.children as THREE.Mesh[]) {
      expect(leg.material).toBe(material) // the same instance as the leg above the deck
      // checkpoint.glb's `grey` (baseColorFactor, linear)
      const c = (leg.material as THREE.MeshStandardMaterial).color
      expect([c.r, c.g, c.b].map((v) => +v.toFixed(3))).toEqual([0.945, 0.949, 0.965])
    }
    // No concrete footing left under a gate: no support pillar within a leg's reach.
    const supports = createRampSupports(track)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    supports.traverse((o) => {
      const inst = o as THREE.InstancedMesh
      if (!inst.isInstancedMesh) return
      for (let k = 0; k < inst.count; k++) {
        inst.getMatrixAt(k, m)
        p.setFromMatrixPosition(m)
        for (const l of planGateLegs(planPieces(track))) expect(Math.hypot(p.x - l.x, p.z - l.z)).toBeGreaterThan(2)
      }
    })
  })
})
