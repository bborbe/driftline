import { describe, expect, it } from 'vitest'
import { EFFECT_KINDS, isEffect, poses, type Track, type Zone } from '../../track/schema'
import { loadTrack } from '../../race/autopilot.test-driver'
import { EFFECT_ICON, EFFECT_LABEL, EFFECT_LOOK, effectIcon } from './effect-pads'
import { ROAD_HALF_WIDTH, ROAD_TOP, ZONE_LIFT, ZONE_WIDTH } from './zones'

const track = loadTrack('test-effects')
const pads = (track.zones ?? []).filter((z): z is Zone & { kind: (typeof EFFECT_KINDS)[number] } => isEffect(z.kind))

const local = (t: Track, zone: Zone, positions: Float32Array) => {
  const e = poses(t)[zone.segment]
  const fx = Math.sin(e.heading)
  const fz = Math.cos(e.heading)
  const out: { lat: number; along: number; dy: number }[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const rx = positions[i] - e.x
    const rz = positions[i + 2] - e.z
    out.push({ lat: rx * fz - rz * fx, along: rx * fx + rz * fz, dy: positions[i + 1] - e.y })
  }
  return out
}

describe('effect pad look', () => {
  it('gives every effect its own colour, label and icon', () => {
    const colours = EFFECT_KINDS.map((k) => EFFECT_LOOK[k].color)
    const labels = EFFECT_KINDS.map((k) => EFFECT_LABEL[k])
    const icons = EFFECT_KINDS.map((k) => JSON.stringify(EFFECT_ICON[k]))
    expect(new Set(colours).size).toBe(EFFECT_KINDS.length)
    expect(new Set(labels).size).toBe(EFFECT_KINDS.length)
    expect(new Set(icons).size).toBe(EFFECT_KINDS.length)
    // Never the turbo pads' yellow or red.
    for (const c of colours) expect([0xffd60a, 0xff2a2a]).not.toContain(c)
  })

  it('test-effects carries one pad of each effect', () => {
    expect(pads.map((z) => z.kind).sort()).toEqual([...EFFECT_KINDS].sort())
  })

  it.each(pads.map((z) => [z.kind, z] as const))('the %s icon sits on its pad, over the asphalt, just above the road', (_k, zone) => {
    const seg = track.segments[zone.segment]
    const len = 'length' in seg ? seg.length : 0
    const icon = effectIcon(track, zone, ZONE_WIDTH, ZONE_LIFT + 0.002)
    expect(icon.length).toBeGreaterThan(0)
    for (const p of local(track, zone, icon)) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(ROAD_HALF_WIDTH + 1e-4)
      expect(p.along).toBeGreaterThanOrEqual(zone.from * len - 1e-4)
      expect(p.along).toBeLessThanOrEqual(zone.to * len + 1e-4)
      expect(p.dy).toBeGreaterThan(ROAD_TOP)
      expect(p.dy).toBeLessThanOrEqual(ROAD_TOP + 0.005 + 1e-9)
    }
  })
})
