// The grounded day look: contact shadow, soft sun shadows, the post pipeline order, the day grade,
// anisotropy on every texture, the palette's white ceiling and the pulled-in noon fog — and Neon
// Night left exactly as it shipped.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { anisotropy, anisotropyFor, ANISOTROPY_CAP, setMaxAnisotropy } from './anisotropy'
import { CONTACT_RIDE_HEIGHT, CONTACT_SHADOW_FADE, contactShadowOpacity, createContactShadow } from './car/contact-shadow'
import { environmentLook } from './environment'
import { BLOOM, glowPreset } from './glow'
import { DAY_GRADE, gradeFor, NEON_GRADE, NO_GRADE } from './grade'
import { ACCENT_ORANGE, CHARCOAL, COOL_BLUE, CURB_WHITE, MINT, WHITE_MAX } from './look'
import { aoRequested, postPasses } from './post'
import { DEFAULT_SETTINGS } from '../menu/settings'
import { settingsFromUrl } from '../menu/url-state'
import { DEFAULT_THEME } from './theme'
import { ROAD_TOP } from './track/zones'
import { SHADOW_MAP_TYPE } from './view'

const noonSunny = { time: 'noon', weather: 'sunny' } as const

describe('contact shadow', () => {
  it('is a dark blob that never writes depth', () => {
    const c = createContactShadow()
    expect(c.material.opacity).toBeGreaterThanOrEqual(0.4)
    expect(c.material.depthWrite).toBe(false)
    expect(c.material.color.getHex()).toBe(0x000000)
    expect(c.object.getObjectByName('contact-shadow')).toBeTruthy()
  })

  it('follows the car on the road and fades as the body lifts off', () => {
    const c = createContactShadow()
    const car = new THREE.Object3D()
    car.position.set(3, 1, -4)
    car.quaternion.setFromEuler(new THREE.Euler(0, 1.2, 0.3))
    c.update(car, 0.6) // suspension compressed: the road sits above the rest ride height
    expect(c.object.visible).toBe(true)
    expect(c.object.position.toArray()).toEqual(car.position.toArray())
    expect(c.object.quaternion.toArray()).toEqual(car.quaternion.toArray())
    expect(c.object.getObjectByName('contact-shadow')!.position.y).toBeCloseTo(-0.6 + ROAD_TOP + 0.003, 6) // 3 mm above the asphalt over the road it found
    expect(contactShadowOpacity(CONTACT_RIDE_HEIGHT)).toBeGreaterThanOrEqual(0.4)
    expect(contactShadowOpacity(CONTACT_RIDE_HEIGHT + CONTACT_SHADOW_FADE / 2)).toBeLessThan(contactShadowOpacity(CONTACT_RIDE_HEIGHT))
    c.update(car, CONTACT_RIDE_HEIGHT + CONTACT_SHADOW_FADE)
    expect(c.object.visible).toBe(false)
    c.update(car, null) // no road under the car
    expect(c.object.visible).toBe(false)
  })
})

describe('sun shadows', () => {
  it('use soft-edged PCF', () => {
    expect(SHADOW_MAP_TYPE).toBe(THREE.PCFSoftShadowMap)
  })
})

describe('post pipeline', () => {
  it('runs scene → bloom → grade by default, FXAA off', () => {
    expect(DEFAULT_SETTINGS.aa).toBe(false)
    expect(postPasses({ bloom: true, ao: aoRequested(''), aa: DEFAULT_SETTINGS.aa })).toEqual(['scene', 'bloom', 'grade'])
  })
  it('adds FXAA last with ?aa=1 and GTAO after the scene with ?ao=1', () => {
    expect(postPasses({ bloom: true, ao: false, aa: settingsFromUrl('?aa=1', DEFAULT_SETTINGS).aa })).toEqual(['scene', 'bloom', 'grade', 'aa'])
    expect(postPasses({ bloom: true, ao: false, aa: settingsFromUrl('?aa=0', DEFAULT_SETTINGS).aa })).toEqual(['scene', 'bloom', 'grade'])
    expect(postPasses({ bloom: true, ao: aoRequested('?ao=1'), aa: true })).toEqual(['scene', 'ao', 'bloom', 'grade', 'aa'])
  })
  it('has no pipeline with ?bloom=0', () => {
    expect(postPasses({ bloom: false, ao: true, aa: true })).toEqual(['scene'])
  })
  it('keeps GTAO opt-in', () => {
    expect(aoRequested('')).toBe(false)
    expect(aoRequested('?ao=1')).toBe(true)
    expect(aoRequested('?ao=0')).toBe(false)
  })
})

describe('colour grade', () => {
  it('grades the day presets with real saturation and contrast', () => {
    expect(Math.abs(DAY_GRADE.saturation - 1)).toBeGreaterThanOrEqual(0.03)
    expect(Math.abs(DAY_GRADE.contrast - 1)).toBeGreaterThanOrEqual(0.03)
    for (const time of ['morning', 'noon', 'sunset'] as const) {
      expect(gradeFor(environmentLook(DEFAULT_THEME, { time, weather: 'sunny' }, noonSunny))).toBe(DAY_GRADE)
    }
  })
  it('leaves night ungraded and Neon Night as it shipped', () => {
    expect(gradeFor(environmentLook(DEFAULT_THEME, { time: 'night', weather: 'sunny' }, noonSunny))).toBe(NO_GRADE)
    const neon = gradeFor(environmentLook(DEFAULT_THEME, { time: 'neon', weather: 'sunny' }, noonSunny))
    expect(neon).toEqual({ tint: [1.06, 0.9, 1.08], saturation: 1, contrast: 1 })
    expect(NEON_GRADE).toEqual([1.06, 0.9, 1.08])
    expect(BLOOM[glowPreset({ night: false, neon: true })]).toEqual({ strength: 1.0, radius: 0.35, threshold: 0.6 })
  })
})

describe('palette', () => {
  it('keeps whites under the clipping ceiling', () => {
    expect(WHITE_MAX).toBeLessThanOrEqual(0.85)
    for (const v of [CURB_WHITE.r, CURB_WHITE.g, CURB_WHITE.b]) expect(v).toBeLessThanOrEqual(WHITE_MAX)
  })
  it('names cool blue, mint, charcoal and one orange accent as sRGB hex', () => {
    for (const c of [COOL_BLUE, MINT, CHARCOAL, ACCENT_ORANGE]) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('noon fog', () => {
  it('is pulled in and tinted to the horizon', () => {
    const look = environmentLook(DEFAULT_THEME, noonSunny, noonSunny)
    expect(look.fogNear).toBeLessThanOrEqual(180)
    expect(look.fogFar).toBeLessThanOrEqual(950)
    expect(look.fog).toBe('#c8d4dc')
  })
})

describe('anisotropy', () => {
  it('uses the GPU maximum up to 16', () => {
    expect(anisotropyFor(16)).toBe(16)
    expect(anisotropyFor(4)).toBe(4)
    expect(anisotropyFor(64)).toBe(ANISOTROPY_CAP)
    expect(anisotropyFor(0)).toBe(1)
    setMaxAnisotropy(12)
    expect(anisotropy()).toBe(12)
    setMaxAnisotropy(8)
  })
  it('is never hard-coded at a texture site', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p)
      }
    }
    walk('src/render')
    const sites = files.filter((f) => /\.anisotropy = /.test(readFileSync(f, 'utf8')))
    expect(sites.length).toBeGreaterThanOrEqual(7)
    for (const f of sites) expect(readFileSync(f, 'utf8')).not.toMatch(/\.anisotropy = \d/)
  })
})
