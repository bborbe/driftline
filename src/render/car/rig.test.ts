import { describe, expect, it } from 'vitest'
import { readGlb } from '../../assets/glb'
import { CAR_MODEL, WHEEL_NODES } from '../../car/wheels'
import { fitRig, PHYSICS_WHEEL_DROP, PHYSICS_WHEEL_RADIUS, PHYSICS_WHEELBASE, spinRate, wheelYaw, type WheelNode } from './rig'

const glb = readGlb(CAR_MODEL)

const wheelNodes = (): WheelNode[] =>
  glb.nodes
    .filter((n) => Object.values(WHEEL_NODES).includes(n.name ?? ''))
    .map((n) => {
      const prim = glb.meshes[n.mesh!].primitives[0]
      const a = glb.accessors[prim.attributes.POSITION]
      return { name: n.name!, translation: n.translation as [number, number, number], radius: (a.max![1] - a.min![1]) / 2 }
    })

describe('car model rig', () => {
  it('loads the car glb and finds all 4 wheel nodes', () => {
    expect(wheelNodes().map((w) => w.name).sort()).toEqual(Object.values(WHEEL_NODES).sort())
  })

  it('scales the model so its wheelbase matches physics', () => {
    const w = wheelNodes()
    const rig = fitRig(w)
    const z = (name: string) => w.find((n) => n.name === name)!.translation[2] * rig.scale + rig.offset[2]
    expect(z(WHEEL_NODES.fl) - z(WHEEL_NODES.rl)).toBeCloseTo(PHYSICS_WHEELBASE, 6)
    expect(z(WHEEL_NODES.fl) + z(WHEEL_NODES.rl)).toBeCloseTo(0, 6) // centred on the body origin
  })

  it('puts wheel centres on the physics suspension: radius 0.35, 0.35 below the body origin', () => {
    const w = wheelNodes()
    const rig = fitRig(w)
    const centreY = rig.wheelY * rig.scale + rig.offset[1]
    expect(centreY).toBeCloseTo(-PHYSICS_WHEEL_DROP, 6)
    expect(w[0].radius * rig.scale * rig.wheelScale).toBeCloseTo(PHYSICS_WHEEL_RADIUS, 6)
  })

  it('keeps the body above the ground plane (no sinking)', () => {
    const body = glb.nodes.find((n) => n.name === 'body')!
    const a = glb.accessors[glb.meshes[body.mesh!].primitives[0].attributes.POSITION]
    const rig = fitRig(wheelNodes())
    const bottom = (body.translation![1] + a.min![1]) * rig.scale + rig.offset[1]
    expect(bottom).toBeGreaterThan(-(PHYSICS_WHEEL_DROP + PHYSICS_WHEEL_RADIUS)) // the ground, in the car frame
  })

  it('steers right for positive steer and spins forward with speed', () => {
    expect(wheelYaw(0.3)).toBeLessThan(0)
    expect(spinRate(7)).toBeCloseTo(20, 6)
  })

  it('refuses a model with a missing wheel', () => {
    expect(() => fitRig(wheelNodes().slice(1))).toThrow(/wheel node/)
  })
})
