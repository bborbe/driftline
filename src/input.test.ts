import { describe, expect, it } from 'vitest'
import { KeyboardInput } from './input'

const press = (target: EventTarget, code: string) => {
  const e = new Event('keydown') as Event & { code: string }
  Object.defineProperty(e, 'code', { value: code })
  target.dispatchEvent(e)
}

describe('keyboard input', () => {
  it.each([
    ['KeyA', -1],
    ['ArrowLeft', -1],
    ['KeyD', 1],
    ['ArrowRight', 1],
  ])('%s steers %i (left = -1)', (code, steer) => {
    const target = new EventTarget()
    const input = new KeyboardInput(target as unknown as Window)
    press(target, code)
    expect(input.read().steer).toBe(steer)
  })
})
