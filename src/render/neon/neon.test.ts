import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { WHEEL_NODES } from '../../car/wheels'
import { centreline } from '../../track/centreline'
import { RAIL, railRuns } from '../../track/rails'
import { loadLap } from '../../track/registry'
import { gateUp } from '../../track/schema'
import { attachLights } from '../car/lights'
import { STADIUM_GAP } from '../decor/stadium'
import { EMISSIVE, GLOW_COLOR, glowClasses, glowMaterial, NEON_GLOW } from '../glow'
import { createNeon, markReflectable, NEON_EDGE_DIM, REFLECT_LAYER, setNeonGlow } from '.'
import { roadMaterials } from './reflection'
import { createSkyline, SKYLINE_INNER, skylinePlan } from './skyline'
import { SPARK, sparkAt, sparkFountains } from './sparks'
import { createNeonTubes, TUBE, tubeGeometry } from './tubes'

const flatout = loadLap('flatout')
const showcase = loadLap('showcase')

const box = (track: ReturnType<typeof loadLap>) => {
  const line = centreline(track, 4)
  const xs = line.map((p) => p.x)
  const zs = line.map((p) => p.z)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

describe('neon skyline', () => {
  it('rings the track with blocks, every one past the stadium ring', () => {
    for (const track of [flatout, showcase]) {
      const blocks = skylinePlan(track)
      const b = box(track)
      expect(blocks.length).toBeGreaterThan(100)
      expect(SKYLINE_INNER).toBeGreaterThan(STADIUM_GAP)
      for (const k of blocks) {
        // Outside the stadium's box by the block's own half size at least.
        const outside = Math.max(b.minX - k.x, k.x - b.maxX, b.minZ - k.z, k.z - b.maxZ)
        expect(outside + 1e-6).toBeGreaterThanOrEqual(STADIUM_GAP + Math.max(k.width, k.depth) / 2)
        expect(k.height).toBeGreaterThan(20)
      }
    }
  })

  it('is the same city every time for a track', () => {
    expect(skylinePlan(flatout)).toEqual(skylinePlan(flatout))
    expect(skylinePlan(flatout, 8)).not.toEqual(skylinePlan(flatout))
  })

  it('draws the whole city as one instanced mesh with lit windows', () => {
    const mesh = createSkyline(flatout)
    expect(mesh.isInstancedMesh).toBe(true)
    expect(mesh.count).toBe(skylinePlan(flatout).length)
    expect((mesh.material as THREE.MeshStandardNodeMaterial).emissiveNode).toBeTruthy()
  })
})

describe('neon tubes', () => {
  it('runs a tube over every rail, the side-1 rails yellow and the side -1 rails pink', () => {
    const tubes = createNeonTubes(flatout)
    const [yellow, pink] = ['neon-tube-yellow', 'neon-tube-pink'].map((n) => tubes.getObjectByName(n) as THREE.Mesh)
    expect((yellow.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(NEON_GLOW.yellow)
    expect((pink.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(NEON_GLOW.pink)
    expect(glowClasses(tubes)).toEqual(new Set(['neon-tube']))
    // A run of n rows sweeps n-1 bands of TUBE.sides quads, two triangles each.
    for (const side of [1, -1] as const) {
      const rows = railRuns(flatout)
        .filter((r) => r.side === side)
        .reduce((sum, r) => sum + r.rows.length - 1, 0)
      expect(tubeGeometry(flatout, side).length).toBe(rows * TUBE.sides * 6 * 3)
    }
  })

  it('keeps a full-width tube where a rail climbs a loop', () => {
    const loop = loadLap('test-loop')
    const positions = tubeGeometry(loop, 1)
    expect(positions.length).toBeGreaterThan(0)
    expect(positions.every(Number.isFinite)).toBe(true)
    // No collapsed band: every triangle has area.
    for (let k = 0; k < positions.length; k += 9) {
      const [a, b, c] = [0, 3, 6].map((o) => [positions[k + o], positions[k + o + 1], positions[k + o + 2]])
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
      expect(area).toBeGreaterThan(0)
    }
  })

  it('floats every tube just above its rail top', () => {
    const positions = tubeGeometry(flatout, 1)
    const tops = railRuns(flatout)
      .filter((r) => r.side === 1)
      .flatMap((r) => r.rows.map(([i, o]) => (i[1] + o[1]) / 2 + RAIL.height))
    const [lo, hi] = [Math.min(...tops), Math.max(...tops)]
    for (let k = 1; k < positions.length; k += 3) {
      expect(positions[k]).toBeGreaterThanOrEqual(lo + TUBE.lift - TUBE.radius - 1e-6)
      expect(positions[k]).toBeLessThanOrEqual(hi + TUBE.lift + TUBE.radius + 1e-6)
    }
  })
})

describe('neon sparks', () => {
  it('stands a fountain beside each leg of every upright gate', () => {
    for (const track of [flatout, showcase]) {
      const upright = track.gates.filter((g) => gateUp(track, g) === 1).length
      expect(sparkFountains(track)).toHaveLength(upright * 2)
    }
  })

  it('flies each spark up from the fountain and back, on a loop of one flight time', () => {
    for (let i = 0; i < SPARK.perFountain; i++)
      for (const t of [0, 0.37, 2.9]) {
        const s = sparkAt(i, t)
        const again = sparkAt(i, t + SPARK.life * 3)
        expect(again.dy).toBeCloseTo(s.dy, 6)
        expect(s.dy).toBeGreaterThanOrEqual(0)
        expect(s.size).toBeGreaterThanOrEqual(0)
        expect(s.size).toBeLessThanOrEqual(SPARK.size)
      }
    const peak = Math.max(...Array.from({ length: 200 }, (_, k) => sparkAt(0, (k / 200) * SPARK.life).dy))
    expect(peak).toBeGreaterThan(1.5) // a jet, not a puddle
  })
})

/** A bare car: one box body and the four named wheel nodes, as glow.test.ts builds it. */
const bareCar = (): THREE.Group => {
  const car = new THREE.Group()
  car.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), new THREE.MeshStandardMaterial()))
  for (const [i, name] of Object.values(WHEEL_NODES).entries()) {
    const w = new THREE.Group()
    w.name = name
    w.position.set(i % 2 === 0 ? 0.8 : -0.8, -0.3, i < 2 ? 1.3 : -1.3)
    car.add(w)
  }
  return car
}

describe('neon car and mirror wiring', () => {
  it('turns the rims pink and dims the edge lines in Neon Night, and restores both after', () => {
    const car = bareCar()
    attachLights(car)
    const rims: THREE.MeshStandardMaterial[] = []
    car.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m?.userData.glow === 'rim' && !rims.includes(m)) rims.push(m)
    })
    expect(rims.length).toBeGreaterThan(0)
    const edge = glowMaterial('edge-line')
    car.add(new THREE.Mesh(new THREE.BoxGeometry(), edge))
    setNeonGlow(car, true)
    for (const m of rims) expect([m.color.getHex(), m.emissive.getHex()]).toEqual([NEON_GLOW.rim, NEON_GLOW.rim])
    expect(edge.emissiveIntensity).toBeCloseTo(EMISSIVE['edge-line'] * NEON_EDGE_DIM)
    setNeonGlow(car, true) // twice in a row still dims once
    expect(edge.emissiveIntensity).toBeCloseTo(EMISSIVE['edge-line'] * NEON_EDGE_DIM)
    setNeonGlow(car, false)
    for (const m of rims) expect(m.emissive.getHex()).toBe(GLOW_COLOR.rim)
    expect(edge.emissiveIntensity).toBe(EMISSIVE['edge-line'])
  })

  it('puts glowing meshes in the mirror pass and leaves the rest out', () => {
    const root = new THREE.Group()
    const glowing = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    glowing.material.userData.glow = 'tail-light'
    const pad = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    pad.material.userData.glow = 'turbo-pad'
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(glowing, pad, plain)
    markReflectable(root)
    const mirror = new THREE.Layers()
    mirror.set(REFLECT_LAYER)
    expect([glowing, pad, plain].map((m) => m.layers.test(mirror))).toEqual([true, false, false])
    expect(glowing.layers.isEnabled(0)).toBe(true) // the main camera still draws it
  })

  it('shows its extras and the reflection only while active, the reflection only with Reflections on', () => {
    const road = new THREE.MeshPhysicalMaterial({ name: 'road' }) as THREE.MeshPhysicalMaterial & { emissiveNode: unknown }
    const trackMesh = new THREE.Mesh(new THREE.BoxGeometry(), road)
    expect(roadMaterials(trackMesh)).toEqual([road])
    const neon = createNeon(flatout, trackMesh)
    expect(neon.object.visible).toBe(false)
    expect(road.emissiveNode).toBeFalsy()
    neon.setActive(true)
    expect(neon.object.visible).toBe(true)
    expect(road.emissiveNode).toBeFalsy() // Reflections are off by default (their fps cost)
    neon.setReflections(true)
    expect(road.emissiveNode).toBeTruthy()
    neon.setReflections(false)
    expect(road.emissiveNode).toBeFalsy()
    neon.setReflections(true)
    neon.setActive(false)
    expect([neon.object.visible, Boolean(road.emissiveNode)]).toEqual([false, false])
  })
})
