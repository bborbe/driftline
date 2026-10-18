import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { readGlb } from '../../assets/glb'
import { WHEEL_NODES, type Corner } from '../../car/wheels'
import { GHOST_OPACITY, createGhostCar } from '../../ghost/mesh'
import { createCar, v3 } from '../../physics'
import { CARS, resolveCar, type CarEntry } from '../cars'
import { attachDetail, isDetail, strobeFade, strobeLimit, type DetailRig } from './detail'
import { attachLights } from './lights'
import { createCarView } from './model'
import { applyLivery, type LiveryCanvas } from './paint'
import { fitRig, type WheelNode } from './rig'

const CORNERS = Object.keys(WHEEL_NODES) as Corner[]

/**
 * A glb car rebuilt from the file's node layout and accessor bounds (GLTFLoader needs a browser
 * fetch), fitted with the same rig as cars.ts: a box per mesh at its node, in the car frame.
 */
const glbStandIn = (entry: CarEntry): THREE.Object3D => {
  const gltf = readGlb(entry.file!)
  const model = new THREE.Group()
  for (const n of gltf.nodes) {
    if (n.mesh === undefined) continue
    const acc = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION]
    const [min, max] = [acc.min!, acc.max!]
    const geo = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2])
    geo.translate((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2)
    const node = new THREE.Group()
    node.name = n.name ?? ''
    node.position.set(...(n.translation ?? [0, 0, 0]))
    node.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()))
    model.add(node)
  }
  const nodes: WheelNode[] = Object.values(WHEEL_NODES).map((name) => {
    const n = model.getObjectByName(name)!
    const b = new THREE.Box3().setFromObject(n)
    return { name, translation: n.position.toArray() as [number, number, number], radius: (b.max.y - b.min.y) / 2 }
  })
  const rig = fitRig(nodes)
  model.scale.setScalar(rig.scale)
  model.position.set(...rig.offset)
  for (const name of Object.values(WHEEL_NODES)) {
    const w = model.getObjectByName(name)!
    w.position.y = rig.wheelY
    w.scale.setScalar(rig.wheelScale)
  }
  const root = new THREE.Group()
  root.add(model)
  return root
}

/** Every registry car in the car frame, with its detail attached. */
const detailed = async (entry: CarEntry): Promise<THREE.Object3D> => (await rigged(entry)).root

const rigged = async (entry: CarEntry): Promise<{ root: THREE.Object3D; rig: DetailRig }> => {
  const root = entry.file ? glbStandIn(entry) : await entry.build()
  const rig = attachDetail(root, entry.cockpit)
  root.updateMatrixWorld(true)
  return { root, rig }
}

const boundsOf = (root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean): THREE.Box3 => {
  const box = new THREE.Box3()
  const part = new THREE.Box3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !keep(o)) return
    m.geometry.computeBoundingBox()
    box.union(part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld))
  })
  return box
}

const underWheel = (o: THREE.Object3D): boolean => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (Object.values(WHEEL_NODES).includes(p.name)) return true
  return false
}

const solidMesh = (root: THREE.Object3D, name: string): THREE.Mesh => {
  const o = root.getObjectByName(name) as THREE.Mesh | undefined
  expect(o, name).toBeDefined()
  expect(o!.isMesh, `${name} is a mesh`).toBe(true)
  expect(o!.geometry.getAttribute('position').count, `${name} vertices`).toBeGreaterThan(0)
  const box = new THREE.Box3().setFromObject(o!)
  expect(box.isEmpty(), `${name} bounds`).toBe(false)
  expect(box.getSize(new THREE.Vector3()).length(), `${name} size`).toBeGreaterThan(0.02)
  return o!
}

describe('car detail', () => {
  for (const entry of CARS) {
    it(`${entry.id}: has arms, a helmet, tread and hubs as real meshes`, async () => {
      const root = await detailed(entry)
      for (const c of CORNERS) {
        for (const arm of ['upper', 'lower']) solidMesh(root, `wishbone-${arm}-${c}`)
        const wheel = root.getObjectByName(WHEEL_NODES[c])!
        for (const part of ['tread', 'hub']) expect(solidMesh(root, `${part}-${c}`).parent, `${part}-${c} under its wheel`).toBe(wheel)
      }
      solidMesh(root, 'helmet')
    })

    it(`${entry.id}: helmet sits above the body's mid-height, arms inside the body-plus-wheel envelope`, async () => {
      const root = await detailed(entry)
      const body = boundsOf(root, (o) => !isDetail(o) && !underWheel(o))
      const helmet = root.getObjectByName('helmet')!.getWorldPosition(new THREE.Vector3())
      expect(helmet.y).toBeGreaterThan((body.min.y + body.max.y) / 2)
      expect(Math.abs(helmet.x)).toBeLessThan(0.05)
      expect(helmet.z).toBeGreaterThan(body.min.z)
      expect(helmet.z).toBeLessThan(body.max.z)
      const envelope = boundsOf(root, (o) => !isDetail(o)).expandByScalar(0.03)
      for (const c of CORNERS) expect(envelope.containsBox(new THREE.Box3().setFromObject(root.getObjectByName(`suspension-${c}`)!)), c).toBe(true)
    })
  }

  for (const entry of CARS) {
    it(`${entry.id}: wheels sit at the spring length and the arms meet them, within 1 mm`, async () => {
      const { root, rig } = await rigged(entry)
      // Wheel centre (its own meshes, not the detail) and every arm's outer end, in the car frame.
      const centreY = (c: Corner): number => boundsOf(root.getObjectByName(WHEEL_NODES[c])!, (o) => !isDetail(o)).getCenter(new THREE.Vector3()).y
      const ends = (c: Corner): THREE.Vector3[] =>
        (['upper', 'lower'] as const).map((a) => {
          const arm = root.getObjectByName(`wishbone-${a}-${c}`)!
          return arm.localToWorld((arm.userData.end as THREE.Vector3).clone())
        })
      const rest = new Map(CORNERS.map((c) => [c, { y: centreY(c), ends: ends(c) }]))
      const mounts = [-0.8, 0.8].flatMap((x) => [-1.3, 1.3].map((z) => ({ x, z })))
      for (const [length, expected] of [
        [0.5, -0.5], // full droop: airborne
        [0.35, -0.35], // the built pose
        [0.2, -0.2], // compressed
      ]) {
        rig.setTravel(mounts.map((mount) => ({ mount, length })))
        root.updateMatrixWorld(true)
        for (const c of CORNERS) {
          expect(centreY(c), `${c} at ${length}`).toBeCloseTo(expected, 3)
          const dy = expected - rest.get(c)!.y
          ends(c).forEach((e, i) => expect(e.distanceTo(rest.get(c)!.ends[i].clone().add(new THREE.Vector3(0, dy, 0))), `${c} arm ${i} at ${length}`).toBeLessThan(0.001))
        }
      }
      // Without springs (the ghost) every wheel is back at its built pose.
      rig.setTravel()
      root.updateMatrixWorld(true)
      for (const c of CORNERS) expect(centreY(c)).toBeCloseTo(rest.get(c)!.y, 6)
    })
  }

  it('fades tread and spokes out before they turn half a pitch per 60 fps frame', () => {
    expect(strobeLimit(20)).toBeCloseTo(3.30, 2) // tread blocks
    expect(strobeLimit(5)).toBeCloseTo(13.19, 2) // spokes
    for (const limit of [strobeLimit(20), strobeLimit(5)]) {
      expect(strobeFade(0, limit)).toBe(1)
      expect(strobeFade(limit, limit)).toBe(0)
      expect(strobeFade(-limit, limit)).toBe(0) // reversing strobes too
      let last = 1
      for (let v = 0; v <= limit * 1.5; v += limit / 50) {
        const f = strobeFade(v, limit)
        expect(f).toBeLessThanOrEqual(last)
        last = f
      }
    }
  })

  it('shows tread and hubs at rest and hides them at 94 km/h', async () => {
    const car = await createCarView('stadium')
    const s = createCar()
    const parts = (): THREE.Mesh[] => CORNERS.flatMap((c) => ['tread', 'hub'].map((p) => car.object.getObjectByName(`${p}-${c}`) as THREE.Mesh))
    car.update(s, 1 / 60)
    for (const m of parts()) {
      expect(m.visible, m.name).toBe(true)
      expect((m.material as THREE.Material).opacity, m.name).toBe(1)
    }
    s.velocity = v3(0, 0, 94 / 3.6)
    car.update(s, 1 / 60)
    for (const m of parts()) expect(m.visible, m.name).toBe(false)
  })

  it('spins the hubs with the wheels', async () => {
    const car = await createCarView('stadium')
    const s = createCar()
    s.velocity = v3(0, 0, 20) // forward at 20 m/s (createCar faces +z)
    const hub = car.object.getObjectByName('hub-fl')!
    const before = new THREE.Quaternion()
    const after = new THREE.Quaternion()
    car.update(s, 1 / 60)
    car.object.updateMatrixWorld(true)
    hub.getWorldQuaternion(before)
    car.update(s, 1 / 60)
    car.object.updateMatrixWorld(true)
    hub.getWorldQuaternion(after)
    expect(before.angleTo(after)).toBeGreaterThanOrEqual(0.1)
  })

  it('leaves the detail out of the livery, and out of its bounds', async () => {
    // The box is the car the arms reach below, so detail in the paint bounds would shift its atlas.
    const canvas = (): LiveryCanvas => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) })
    const liveryUVs = (root: THREE.Object3D): number[][] => {
      const out: number[][] = []
      root.traverse((o) => o.name === 'livery' && out.push(Array.from((o as THREE.Mesh).geometry.getAttribute('uv').array)))
      return out
    }
    const entry = resolveCar('box')
    const plain = await entry.build()
    attachLights(plain)
    applyLivery(plain, { pattern: 'checker', paint: 'blue', number: 3 }, canvas)
    const car = await entry.build()
    attachLights(car)
    attachDetail(car, entry.cockpit)
    applyLivery(car, { pattern: 'checker', paint: 'blue', number: 3 }, canvas)
    const uvs = liveryUVs(car)
    expect(uvs.length).toBeGreaterThan(0)
    expect(uvs).toEqual(liveryUVs(plain))
    car.traverse((o) => {
      if (o.name === 'livery') expect(isDetail(o), 'livery mesh under detail').toBe(false)
      if (isDetail(o) && (o as THREE.Mesh).isMesh) expect(((o as THREE.Mesh).material as THREE.Material).name).toMatch(/^detail-/)
    })
  })

  it('casts a shadow from the helmet only', async () => {
    const car = await createCarView('stadium')
    const casters: string[] = []
    car.object.traverse((o) => isDetail(o) && (o as THREE.Mesh).isMesh && o.castShadow && casters.push(o.name))
    expect(casters).toEqual(['helmet'])
  })

  it('renders the detail translucent on the ghost', async () => {
    const ghost = await createGhostCar('stadium')
    let n = 0
    ghost.object.traverse((o) => {
      if (!isDetail(o) || !(o as THREE.Mesh).isMesh) return
      n++
      expect(((o as THREE.Mesh).material as THREE.Material).opacity).toBe(GHOST_OPACITY)
    })
    ghost.update(createCar(), 1 / 60) // the speed fade keeps the ghost's own opacity at rest
    ghost.object.traverse((o) => {
      if (isDetail(o) && (o as THREE.Mesh).isMesh) expect(((o as THREE.Mesh).material as THREE.Material).opacity).toBe(GHOST_OPACITY)
    })
    expect(n).toBeGreaterThanOrEqual(4 * 4 + 2) // two arms, tread and hub per corner, helmet and visor
  })

  it('every registry car names a cockpit', () => {
    for (const c of CARS) expect(resolveCar(c.id).cockpit, c.id).toBeDefined()
  })
})
