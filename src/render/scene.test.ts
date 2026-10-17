import { describe, expect, it } from 'vitest'
import { createGround } from './scene'

describe('ground plane', () => {
  it('never occludes the road: drawn first, no depth writes', () => {
    const g = createGround()
    expect((g.material as { depthWrite: boolean }).depthWrite).toBe(false)
    expect(g.renderOrder).toBeLessThan(0)
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
