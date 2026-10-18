import { describe, expect, it } from 'vitest'
import { createCarAt, FixedStepper, TICK_HZ, type CarInput } from '../physics'
import { clampFrameCap, effectiveCap, FRAME_CAPS, FrameGate, IDLE_FPS, MENU_FPS, probeable } from './frame-cap'

const DRIVE: CarInput = { throttle: 1, brake: 0, steer: 0.3, handbrake: false }

/** Rendered-frame times over `seconds` of a `hz` display under `fps`, with ±0.5 ms vsync jitter. */
function rendered(hz: number, fps: number, seconds: number): number[] {
  const gate = new FrameGate()
  const out: number[] = []
  for (let i = 0; i <= seconds * hz; i++) {
    const now = (i * 1000) / hz + (i % 2 ? 0.5 : -0.5)
    if (gate.due(now, fps)) out.push(now)
  }
  return out
}

/** Drives a stepper the way main.ts does: elapsed since the last rendered frame; returns the tick at each frame. */
function drive(frames: number[]): { ticks: number[]; stepper: FixedStepper } {
  const stepper = new FixedStepper(createCarAt({ x: 0, y: 0.5, z: 0, heading: 0 }))
  const ticks: number[] = []
  let last = frames[0]
  for (const now of frames) {
    stepper.advance((now - last) / 1000, DRIVE)
    last = now
    ticks.push(stepper.state.tick)
  }
  return { ticks, stepper }
}

describe('frame cap', () => {
  it('holds the cap on 60, 120 and 144 Hz displays; uncapped renders every vsync', () => {
    for (const hz of [60, 120, 144]) {
      expect(rendered(hz, 0, 10).length).toBe(hz * 10 + 1)
      for (const fps of [30, 60, 120, IDLE_FPS]) {
        const rate = (rendered(hz, fps, 10).length - 1) / 10
        expect(rate, `${fps} on ${hz} Hz`).toBeGreaterThanOrEqual(Math.min(fps, hz) * 0.93)
        expect(rate, `${fps} on ${hz} Hz`).toBeLessThanOrEqual(Math.min(fps, hz) * 1.01)
      }
    }
  })

  it('leaves the physics step count per simulated second unchanged under every cap and ceiling', () => {
    const seconds = 10
    for (const hz of [60, 144]) {
      const caps = [...FRAME_CAPS, IDLE_FPS, MENU_FPS]
      for (const fps of caps) {
        const frames = rendered(hz, fps, seconds)
        const { ticks, stepper } = drive(frames)
        // At every rendered instant the tick is the one an uncapped loop has at that instant: floor(t · 100 Hz).
        frames.forEach((t, i) => expect(Math.abs(ticks[i] - Math.floor(((t - frames[0]) / 1000) * TICK_HZ))).toBeLessThanOrEqual(1))
        // And the car is bit-identical to stepping the same ticks one by one.
        const direct = new FixedStepper(createCarAt({ x: 0, y: 0.5, z: 0, heading: 0 }))
        while (direct.state.tick < stepper.state.tick) direct.advance(1 / TICK_HZ, DRIVE)
        expect(stepper.state).toEqual(direct.state)
      }
    }
  })

  it('renders nothing while hidden, and resumes after', () => {
    const gate = new FrameGate()
    expect(gate.due(0, 0, true)).toBe(false)
    expect(gate.due(16, 30, true)).toBe(false)
    expect(gate.due(32, 30)).toBe(true)
  })

  it('lowers the cap to the screen ceiling', () => {
    expect(effectiveCap(0, 0)).toBe(0)
    expect(effectiveCap(60, 0)).toBe(60)
    expect(effectiveCap(0, IDLE_FPS)).toBe(IDLE_FPS)
    expect(effectiveCap(120, MENU_FPS)).toBe(MENU_FPS)
    expect(effectiveCap(30, IDLE_FPS)).toBe(IDLE_FPS)
    expect(effectiveCap(30, MENU_FPS)).toBe(30)
  })

  it('feeds the Auto quality probe only frames a cap cannot slow below its High threshold', () => {
    expect(probeable(0)).toBe(true)
    expect(probeable(120)).toBe(true)
    for (const fps of [60, 30, MENU_FPS, IDLE_FPS]) expect(probeable(fps), String(fps)).toBe(fps > 55)
  })

  it('accepts only the listed caps', () => {
    for (const c of FRAME_CAPS) expect(clampFrameCap(c)).toBe(c)
    for (const c of [45, -1, '30', null, NaN]) expect(clampFrameCap(c)).toBe(0)
  })
})
