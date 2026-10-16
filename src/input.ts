import type { CarInput } from './physics'

// Keyboard state → CarInput. WASD or arrows; Space = handbrake.
export class KeyboardInput {
  private down = new Set<string>()

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.down.add(e.code))
    target.addEventListener('keyup', (e) => this.down.delete(e.code))
    target.addEventListener('blur', () => this.down.clear())
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c))
  }

  read(): CarInput {
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: this.any('Space'),
    }
  }
}
