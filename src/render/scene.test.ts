import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { LAP_NAMES, loadLap } from '../track/registry'
import { GRASS_MEAN, createGround, isSnowGround } from './scene'
import { resolveTheme } from './theme'

type Rgb = readonly [number, number, number]

/** sRGB 0–255 → linear 0–1 per channel, and back. */
const toLinear = ([r, g, b]: Rgb): Rgb => {
  const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
  return [c.r, c.g, c.b]
}
const toSrgb = ([r, g, b]: Rgb): Rgb => {
  const s = new THREE.Color(r, g, b).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  const byte = (v: number) => Math.round(v * 255)
  return [byte(s.r), byte(s.g), byte(s.b)]
}
const hexRgb = (hex: string): Rgb => {
  const c = new THREE.Color(hex)
  return toSrgb([c.r, c.g, c.b])
}
const times = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]

/** The ground's colour before lighting, sRGB 0–255: material colour × the map's mean colour (no map: the colour alone). */
const effectiveGround = (ground: THREE.Mesh): Rgb => {
  const m = ground.material as THREE.MeshStandardMaterial
  const colour: Rgb = [m.color.r, m.color.g, m.color.b]
  return toSrgb(m.map ? times(colour, toLinear(GRASS_MEAN)) : colour)
}

const within = (actual: Rgb, expected: Rgb, tolerance: number) =>
  actual.forEach((c, i) => expect(Math.abs(c - expected[i]), `channel ${i}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance))

describe('ground plane', () => {
  it('never occludes the road: drawn first, no depth writes', () => {
    const g = createGround()
    expect((g.material as { depthWrite: boolean }).depthWrite).toBe(false)
    expect(g.renderOrder).toBeLessThan(0)
  })

  it('glacier is a snow ground; the default grass is not', () => {
    expect(isSnowGround(resolveTheme(loadLap('glacier')).ground)).toBe(true)
    expect(isSnowGround(resolveTheme(loadLap('test1')).ground)).toBe(false)
  })

  it('a ground with no map still takes its tint', () => {
    within(effectiveGround(createGround(undefined, '#e8f1f5')), hexRgb('#e8f1f5'), 1)
  })

  // Glacier rendered olive: its near-white snow tint was multiplied onto the dry-yellow grass texture.
  // createWorld hands every track the grass texture and its theme ground, exactly as here.
  describe.each(LAP_NAMES)('%s', (name) => {
    const ground = resolveTheme(loadLap(name)).ground
    const effective = effectiveGround(createGround(new THREE.Texture(), ground))
    if (isSnowGround(ground)) {
      it('snow ground shows its theme colour, not grass × tint', () => within(effective, hexRgb(ground), 12))
    } else {
      it('grass ground keeps grass × tint', () => within(effective, toSrgb(times(toLinear(hexRgb(ground)), toLinear(GRASS_MEAN))), 3))
    }
  })
})

describe('applyLighting (live time / weather)', () => {
  it('re-points the same scene, sun and fog at a new look, without new objects', async () => {
    const THREE = await import('three/webgpu')
    const { applyLighting } = await import('./scene')
    const { environmentLook } = await import('./environment')
    const { DEFAULT_THEME } = await import('./theme')
    const { DEFAULT_ENVIRONMENT } = await import('../track/environment')
    const theme = { ...DEFAULT_THEME } as Parameters<typeof environmentLook>[0]
    const scene = new THREE.Scene()
    const sun = new THREE.DirectionalLight()
    const noon = environmentLook(theme, DEFAULT_ENVIRONMENT, DEFAULT_ENVIRONMENT)
    applyLighting(scene, sun, noon)
    const fog = scene.fog as InstanceType<typeof THREE.Fog>
    const noonSun = sun.color.getHex()
    const noonIntensity = sun.intensity
    const night = environmentLook(theme, { time: 'night', weather: 'rain' }, DEFAULT_ENVIRONMENT)
    applyLighting(scene, sun, night)
    expect(scene.fog).toBe(fog) // updated in place
    expect(fog.color.getHexString()).toBe(new THREE.Color(night.fog).getHexString())
    expect(fog.far).toBe(night.fogFar)
    expect(sun.color.getHex()).not.toBe(noonSun)
    expect(sun.intensity).toBe(night.sunIntensity)
    expect(sun.intensity).toBeLessThan(noonIntensity)
    expect(scene.environmentIntensity).toBe(night.skyLight)
    expect(scene.backgroundIntensity).toBe(night.skyBrightness)
    // And back: the noon look is restored exactly.
    applyLighting(scene, sun, noon)
    expect(sun.color.getHex()).toBe(noonSun)
    expect(sun.intensity).toBe(noonIntensity)
  })
})
