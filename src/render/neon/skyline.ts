// Neon Night skyline: rows of dark tower blocks round the stadium, past its ring, with lit windows.
// One InstancedMesh (one draw call) of unit boxes; the windows are drawn in the shader from the world
// position, so a tall block gets more floors rather than stretched panes, and no texture is loaded.
// The plan is pure and seeded, so the same track always gets the same city.
import * as THREE from 'three/webgpu'
import { abs, color, floor, fract, hash, mix, normalWorld, positionWorld, select, step } from 'three/tsl'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { STADIUM_GAP } from '../decor/stadium'

/** First row of blocks this far outside the centreline's box: past the stadium ring (STADIUM_GAP) and its stands. */
export const SKYLINE_INNER = STADIUM_GAP + 45
/** Rows outward from SKYLINE_INNER (metres) and the height range of each: the back rows stand taller. */
export const SKYLINE_ROWS = [
  { offset: 0, minH: 22, maxH: 60 },
  { offset: 38, minH: 35, maxH: 95 },
  { offset: 80, minH: 50, maxH: 140 },
] as const
/** Mean spacing of blocks along a row. */
const STEP = 17

/** Window grid on the facades: pane pitch across and up (a floor), and the share of panes lit. */
export const WINDOW = { across: 2.6, up: 3.4, lit: 0.2 } as const

export type Block = { x: number; z: number; width: number; depth: number; height: number }

const mulberry32 = (seed: number) => {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The blocks for `track`: each row walks the rectangle SKYLINE_INNER + row.offset outside the
 * centreline's bounding box, one block every ~STEP metres, jittered in size and height.
 */
export const skylinePlan = (track: Track, seed = 7): Block[] => {
  const line = centreline(track, 4)
  const xs = line.map((p) => p.x)
  const zs = line.map((p) => p.z)
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const rand = mulberry32(seed)
  const out: Block[] = []
  for (const row of SKYLINE_ROWS) {
    const d = SKYLINE_INNER + row.offset
    const [x0, x1, z0, z1] = [minX - d, maxX + d, minZ - d, maxZ + d]
    // The rectangle's four sides as start corner, direction and length, walked in turn.
    const sides: [number, number, number, number, number][] = [
      [x0, z0, 1, 0, x1 - x0],
      [x1, z0, 0, 1, z1 - z0],
      [x1, z1, -1, 0, x1 - x0],
      [x0, z1, 0, -1, z1 - z0],
    ]
    for (const [sx, sz, dx, dz, length] of sides)
      for (let t = rand() * STEP; t < length; t += STEP * (0.75 + rand() * 0.5)) {
        const width = 9 + rand() * 13
        const depth = 9 + rand() * 13
        out.push({ x: sx + dx * t, z: sz + dz * t, width, depth, height: row.minH + rand() * (row.maxH - row.minH) })
      }
  }
  return out
}

/** Block facade: near-black, so the lit windows carry it. */
const WALL = 0x0b0a14
/** Window colours: warm office light, with a large share of pink and cyan panes (the neon city). */
const WARM = 0xffb54d
const PINK = 0xff4fc8
const CYAN = 0x4fe3ff
/** Emission of a lit pane: over the neon bloom threshold, so the city twinkles through the haze. */
export const WINDOW_INTENSITY = 1.3

const windowMaterial = (): THREE.MeshStandardNodeMaterial => {
  const material = new THREE.MeshStandardNodeMaterial({ color: WALL, roughness: 0.9 })
  // Facades facing ±x run their panes along z, the others along x; roofs (normal up) stay dark.
  const across = select(abs(normalWorld.x).greaterThan(0.5), positionWorld.z, positionWorld.x).div(WINDOW.across)
  const up = positionWorld.y.div(WINDOW.up)
  const [u, v] = [fract(across), fract(up)]
  const pane = step(0.22, u).mul(step(u, 0.78)).mul(step(0.3, v)).mul(step(v, 0.72))
  // A seed per pane from its cell, offset positive (the hash reads it as an unsigned int).
  const cell = floor(across).mul(127.1).add(floor(up).mul(311.7)).add(1e5)
  const lit = step(1 - WINDOW.lit, hash(cell))
  const wall = step(abs(normalWorld.y), 0.5)
  const accent = hash(cell.add(17.3))
  const tint = mix(mix(color(WARM), color(PINK), step(0.55, accent)), color(CYAN), step(0.8, accent))
  material.emissiveNode = tint.mul(pane.mul(lit).mul(wall).mul(WINDOW_INTENSITY))
  return material
}

/** The whole skyline as one instanced mesh of unit boxes standing on y = 0. */
export const createSkyline = (track: Track): THREE.InstancedMesh => {
  const blocks = skylinePlan(track)
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const mesh = new THREE.InstancedMesh(geometry, windowMaterial(), blocks.length)
  mesh.name = 'neon-skyline'
  const m = new THREE.Matrix4()
  for (const [i, b] of blocks.entries()) mesh.setMatrixAt(i, m.makeScale(b.width, b.height, b.depth).setPosition(b.x, 0, b.z))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}
