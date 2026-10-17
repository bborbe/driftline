// The neon line runs on the rail tops: one ribbon span per rail box, on the top face of the swept
// rail it belongs to, in an emissive material.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveTrack } from '../../track/kit'
import { RAIL, railBoxes, railRuns } from '../../track/rails'
import type { Track } from '../../track/schema'
import { createRails, neonGeometry, neonMaterial, railGeometry } from './rails'

const load = (name: string) => resolveTrack(JSON.parse(readFileSync(new URL(`../../../assets/track/${name}.json`, import.meta.url), 'utf8'))) as Track

// Neon may sit this far off the rail top: DECAL_LIFT plus a margin, the task's 5 cm.
const NEAR = 0.05

describe.each(['test1', 'test2', 'crossover', 'looping', 'test-wallride'])('%s neon', (name) => {
  const track = load(name)

  it('spans every rail box, each span on the top of its own rail', () => {
    const neon = neonGeometry(track)
    const spans = neon.length / 18 // two triangles per span
    expect(spans).toBe(railBoxes(track).length)
    let s = 0
    for (const { rows } of railRuns(track)) {
      for (let r = 0; r < rows.length - 1; r++, s++) {
        for (let v = 0; v < 6; v++) {
          const [x, y, z] = [neon[s * 18 + v * 3], neon[s * 18 + v * 3 + 1], neon[s * 18 + v * 3 + 2]]
          // Nearest of the span's two rows across the rail (inner→outer at each end).
          const d = Math.min(
            ...[rows[r], rows[r + 1]].map(([i, o]) => {
              const [dx, dz] = [o[0] - i[0], o[2] - i[2]]
              const len = Math.hypot(dx, dz)
              const along = ((x - i[0]) * dx + (z - i[2]) * dz) / len
              const off = Math.abs((x - i[0]) * dz - (z - i[2]) * dx) / len
              const top = i[1] + ((o[1] - i[1]) * along) / len + RAIL.height
              return along >= -1e-6 && along <= len + 1e-6 ? Math.hypot(off, y - top) : Infinity
            }),
          )
          expect(d, `${name} neon span ${s} vertex ${v}`).toBeLessThan(NEAR)
        }
      }
    }
  })

  it('draws the rails as solids over the same rows', () => {
    // Four faces per row pair and two end caps per run, two triangles each, nine floats per triangle.
    const runs = railRuns(track)
    const quads = runs.reduce((n, r) => n + 4 * (r.rows.length - 1) + 2, 0)
    expect(railGeometry(track).length).toBe(quads * 18)
  })
})

describe('neon material', () => {
  it('glows: emissive at a positive intensity', () => {
    expect(neonMaterial.emissiveIntensity).toBeGreaterThan(0)
    expect(neonMaterial.emissive.getHex()).not.toBe(0)
  })

  it('is the neon mesh createRails() adds beside the rail', () => {
    const group = createRails(load('test1'))
    expect(group.children.map((c) => c.name)).toEqual(['rail', 'neon'])
  })
})
