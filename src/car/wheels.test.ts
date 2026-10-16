import { describe, expect, it } from 'vitest'
import { readGlb } from '../assets/glb'
import { CAR_MODEL, STEERED, WHEEL_NODES } from './wheels'

describe('car model wheels', () => {
  const gltf = readGlb(CAR_MODEL)
  const byName = new Map(gltf.nodes.map((n, i) => [n.name, i]))

  it('has a separate mesh node for each of the 4 mapped wheels', () => {
    const meshes = Object.values(WHEEL_NODES).map((name) => {
      const i = byName.get(name)
      expect(i, `node ${name}`).toBeDefined()
      const node = gltf.nodes[i!]
      expect(node.mesh, `${name} has a mesh`).toBeDefined()
      return i
    })
    expect(new Set(meshes).size).toBe(4)
  })

  it('steers only the front pair', () => {
    expect(STEERED.map((c) => WHEEL_NODES[c])).toEqual(['wheel-front-left', 'wheel-front-right'])
  })

  it('keeps wheels out of the body so they can transform independently', () => {
    const body = gltf.nodes[byName.get('body')!]
    for (const name of Object.values(WHEEL_NODES)) expect(body.children ?? []).not.toContain(byName.get(name))
  })
})
