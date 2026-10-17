import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENVIRONMENT,
  environmentLabel,
  MAX_SEED,
  randomEnvironment,
  resolveEnvironment,
  TIMES,
  trackEnvironment,
  validateEnvironment,
  WEATHER_CHOICES,
  WEATHERS,
} from './environment'
import { LAP_NAMES, loadLap } from './registry'
import { layoutId, validate } from './schema'

const sunsetTrack = { environment: { time: 'sunset', weather: 'cloudy' } } as const

describe('validateEnvironment', () => {
  it('accepts every time and weather, and either one alone', () => {
    for (const time of TIMES) for (const weather of WEATHERS) expect(validateEnvironment({ time, weather })).toEqual([])
    expect(validateEnvironment({ time: 'night' })).toEqual([])
    expect(validateEnvironment({})).toEqual([])
  })

  it('rejects unknown values and keys', () => {
    expect(validateEnvironment({ time: 'dawn' })[0]).toMatch(/^environment\.time must be one of/)
    expect(validateEnvironment({ weather: 'hail' })[0]).toMatch(/^environment\.weather must be one of/)
    expect(validateEnvironment({ wether: 'rain' })).toEqual(['environment.wether: unknown key'])
    expect(validateEnvironment('night')).toEqual(['environment must be an object'])
  })

  it('is checked as part of a track file', () => {
    const track = { ...loadLap('test1'), environment: { time: 'midnight' } }
    expect(validate(track).some((e) => e.startsWith('environment.time'))).toBe(true)
  })
})

describe('track defaults', () => {
  it('falls back to noon sunny field by field', () => {
    expect(trackEnvironment({})).toEqual(DEFAULT_ENVIRONMENT)
    expect(trackEnvironment({ environment: { weather: 'rain' } })).toEqual({ time: 'noon', weather: 'rain' })
  })

  it('every shipped track declares its default, and it is not part of the layout id (records and ghosts stay)', () => {
    for (const name of LAP_NAMES) {
      const track = loadLap(name)
      expect(track.environment?.time, name).toBeDefined()
      expect(track.environment?.weather, name).toBeDefined()
      const { environment: _, ...without } = track
      expect(layoutId(without), name).toBe(layoutId(track))
    }
  })
})

describe('resolveEnvironment', () => {
  it('fixed: the track default', () => {
    expect(resolveEnvironment('', sunsetTrack, 'fixed', 42)).toEqual({ time: 'sunset', weather: 'cloudy', source: 'track' })
  })

  it('random: a seeded pick, the same for the same seed', () => {
    const a = resolveEnvironment('', sunsetTrack, 'random', 1234)
    expect(a).toEqual({ ...randomEnvironment(1234), source: 'random', seed: 1234 })
    expect(resolveEnvironment('', sunsetTrack, 'random', 1234)).toEqual(a)
  })

  it('random seeds stay in range, so the debug line and ?seed= stay short', () => {
    const r = resolveEnvironment('', {}, 'random', 1_760_000_000_123)
    expect(r.seed).toBeGreaterThanOrEqual(0)
    expect(r.seed).toBeLessThanOrEqual(MAX_SEED)
  })

  it('?seed= replays a random pick even in fixed mode', () => {
    expect(resolveEnvironment('?seed=77', sunsetTrack, 'fixed', 1)).toEqual({ ...randomEnvironment(77), source: 'random', seed: 77 })
  })

  it('?time= and ?weather= override, each on its own', () => {
    expect(resolveEnvironment('?time=night&weather=rain', sunsetTrack, 'random', 5)).toEqual({ time: 'night', weather: 'rain', source: 'url' })
    expect(resolveEnvironment('?weather=rain', sunsetTrack, 'fixed', 5)).toEqual({ time: 'sunset', weather: 'rain', source: 'url' })
    expect(resolveEnvironment('?time=morning', sunsetTrack, 'fixed', 5)).toEqual({ time: 'morning', weather: 'cloudy', source: 'url' })
  })

  it('ignores an unknown override value', () => {
    expect(resolveEnvironment('?time=dawn&weather=hail', sunsetTrack, 'fixed', 5)).toEqual({ time: 'sunset', weather: 'cloudy', source: 'track' })
  })

  it('random reaches every time and every weather', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 400; seed++) {
      const e = randomEnvironment(seed)
      seen.add(e.time)
      seen.add(e.weather)
    }
    expect([...seen].sort()).toEqual([...TIMES, ...WEATHERS].sort())
  })
})

describe('snow', () => {
  it('?weather=snow overrides any track default', () => {
    expect(resolveEnvironment('?weather=snow', sunsetTrack, 'fixed', 5)).toEqual({ time: 'sunset', weather: 'snow', source: 'url' })
  })

  it("is glacier's default weather", () => {
    expect(resolveEnvironment('', loadLap('glacier'), 'fixed', 5)).toEqual({ time: 'noon', weather: 'snow', source: 'track' })
  })

  it('the random pick can land on snow', () => {
    const seed = Array.from({ length: MAX_SEED + 1 }, (_, s) => s).find((s) => randomEnvironment(s).weather === 'snow')
    expect(seed).toBeDefined()
    expect(resolveEnvironment(`?seed=${seed}`, sunsetTrack, 'fixed', 1).weather).toBe('snow')
  })

  it('is a Settings weather choice, and choosing it resolves to snow', () => {
    expect(WEATHER_CHOICES).toContain('snow')
    expect(resolveEnvironment('', sunsetTrack, { time: 'default', weather: 'snow' }, 5)).toEqual({ time: 'sunset', weather: 'snow', source: 'setting' })
  })
})

describe('resolveEnvironment with a Time / Weather choice', () => {
  it('takes each field from its own choice: track default, a preset, or the seeded pick', () => {
    expect(resolveEnvironment('', sunsetTrack, { time: 'default', weather: 'default' }, 5)).toEqual({ time: 'sunset', weather: 'cloudy', source: 'track' })
    expect(resolveEnvironment('', sunsetTrack, { time: 'night', weather: 'default' }, 5)).toEqual({ time: 'night', weather: 'cloudy', source: 'setting' })
    expect(resolveEnvironment('', sunsetTrack, { time: 'night', weather: 'rain' }, 5)).toEqual({ time: 'night', weather: 'rain', source: 'setting' })
    const picked = randomEnvironment(1234)
    expect(resolveEnvironment('', sunsetTrack, { time: 'random', weather: 'rain' }, 1234)).toEqual({ time: picked.time, weather: 'rain', source: 'random', seed: 1234 })
    expect(resolveEnvironment('', sunsetTrack, { time: 'morning', weather: 'random' }, 1234)).toEqual({ time: 'morning', weather: picked.weather, source: 'random', seed: 1234 })
  })
  it('lets the URL override a choice at load, field by field', () => {
    expect(resolveEnvironment('?weather=sunny', sunsetTrack, { time: 'night', weather: 'rain' }, 5)).toEqual({ time: 'night', weather: 'sunny', source: 'url' })
  })
})

describe('environmentLabel', () => {
  it('names the preset and how it was chosen', () => {
    expect(environmentLabel({ time: 'noon', weather: 'sunny', source: 'track' })).toBe('noon sunny')
    expect(environmentLabel({ time: 'night', weather: 'rain', source: 'random', seed: 812 })).toBe('night rain random #812')
    expect(environmentLabel({ time: 'sunset', weather: 'cloudy', source: 'url' })).toBe('sunset cloudy url')
  })
})
