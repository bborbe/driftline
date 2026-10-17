import { readFileSync } from 'node:fs'
import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { WHEEL_NODES } from '../car/wheels'
import type { Track } from '../track/schema'
import { attachLights } from './car/lights'
import { BLOOM, bloomFor, BRAKE_EMISSIVE, EMISSIVE, GLOW_COLOR, glowClasses, glowLuminance, glowPasses, tailLightIntensity } from './glow'
import { createEdgeLines } from './track/curbs'
import { createZoneMeshes } from './track/zones'

const lap2 = JSON.parse(readFileSync(new URL('../../assets/track/test2.json', import.meta.url), 'utf8')) as Track

/** A bare car: one box body and the four named wheel nodes, as every registry entry exposes them. */
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

const materialsOf = (root: THREE.Object3D, glow: string): THREE.MeshStandardMaterial[] => {
  const out: THREE.MeshStandardMaterial[] = []
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m?.userData.glow === glow) out.push(m)
  })
  return out
}

describe('glow pass', () => {
  it('runs bloom by default and drops it on ?bloom=0', () => {
    expect(glowPasses('')).toEqual(['scene', 'bloom'])
    expect(glowPasses('?track=test1')).toEqual(['scene', 'bloom'])
    for (const off of ['?bloom=0', '?bloom=off', '?bloom=false']) {
      expect(bloomFor(off)).toBeNull()
      expect(glowPasses(off)).toEqual(['scene'])
    }
  })

  it('uses the night preset at night, at least 1.5x the day strength', () => {
    expect(bloomFor('')).toBe(BLOOM.day)
    expect(bloomFor('', 'night')).toBe(BLOOM.night)
    expect(bloomFor('?bloom=0', 'night')).toBeNull()
    expect(BLOOM.night.strength).toBeGreaterThanOrEqual(1.5 * BLOOM.day.strength)
    expect(BLOOM.night.threshold).toBeLessThan(BLOOM.day.threshold)
  })

  it('keeps every glow colour bright enough to clear the day bloom threshold', () => {
    for (const [glow, hex] of Object.entries(GLOW_COLOR)) expect(glowLuminance(hex, EMISSIVE[glow as keyof typeof GLOW_COLOR])).toBeGreaterThan(BLOOM.day.threshold)
  })

  it('brightens the tail lights on the brake', () => {
    expect(tailLightIntensity(true)).toBe(BRAKE_EMISSIVE)
    expect(tailLightIntensity(true)).toBeGreaterThan(tailLightIntensity(false))
  })
})

describe('glow wiring', () => {
  it('builds the road edge lines with the edge-line glow material', () => {
    const edges = createEdgeLines(lap2)
    expect(glowClasses(edges)).toEqual(new Set(['edge-line']))
    expect(edges.geometry.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('builds turbo pads with the turbo-pad glow material, and no other zone glows', () => {
    const zones = createZoneMeshes(lap2)
    expect(glowClasses(zones)).toEqual(new Set(['turbo-pad']))
    const pads = materialsOf(zones, 'turbo-pad')
    expect(pads.length).toBeGreaterThan(0)
    // The yellow standard pad clears the day threshold on its own colour.
    expect(Math.max(...pads.map((m) => glowLuminance(m.emissive.getHex(), m.emissiveIntensity)))).toBeGreaterThan(BLOOM.day.threshold)
  })

  it('gives a car tail lights, headlights and a rim ring on every wheel', () => {
    const car = bareCar()
    attachLights(car)
    expect(glowClasses(car)).toEqual(new Set(['tail-light', 'headlight', 'rim']))
    for (const name of Object.values(WHEEL_NODES)) expect(car.getObjectByName(name)!.getObjectByName('rim-glow')).toBeDefined()
    // Tail lights at the rear (-z), headlights at the nose (+z).
    const z = (glow: string) => {
      const zs: number[] = []
      car.traverse((o) => {
        if ((o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).userData.glow === glow) zs.push(o.position.z)
      })
      return zs
    }
    for (const t of z('tail-light')) expect(t).toBeLessThan(-2)
    for (const h of z('headlight')) expect(h).toBeGreaterThan(2)
  })

  it('switches the tail-light material on the brake and back', () => {
    const car = bareCar()
    const lights = attachLights(car)
    const [tail] = materialsOf(car, 'tail-light')
    expect(tail.emissiveIntensity).toBe(tailLightIntensity(false))
    lights.setBraking(true)
    expect(tail.emissiveIntensity).toBe(BRAKE_EMISSIVE)
    lights.setBraking(false)
    expect(tail.emissiveIntensity).toBe(tailLightIntensity(false))
  })
})
