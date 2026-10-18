import type { CarInput } from './physics'
import { BINDINGS_EVENT, DEFAULT_BINDINGS, isBound, loadBindings, type Action, type Bindings } from './bindings'

// Keyboard state → CarInput through the player's key bindings (Settings → Controls, src/bindings.ts); the
// defaults are WASD or arrows, Space = handbrake. A bindings change applies at once.
export class KeyboardInput {
  private down = new Set<string>()
  private bindings: Bindings

  constructor(target: Window = window, bindings: Bindings = typeof localStorage === 'undefined' ? DEFAULT_BINDINGS : loadBindings(localStorage)) {
    this.bindings = bindings
    target.addEventListener('keydown', (e) => this.down.add(e.code))
    target.addEventListener('keyup', (e) => this.down.delete(e.code))
    target.addEventListener('blur', () => this.down.clear())
    target.addEventListener(BINDINGS_EVENT, (e) => (this.bindings = (e as CustomEvent<Bindings>).detail))
  }

  private pressed(action: Action): boolean {
    return [...this.down].some((c) => isBound(this.bindings, action, c))
  }

  /** Key codes held right now (the free-fly camera reads its own keys from these). */
  held(): ReadonlySet<string> {
    return this.down
  }

  read(): CarInput {
    return {
      throttle: this.pressed('throttle') ? 1 : 0,
      brake: this.pressed('brake') ? 1 : 0,
      steer: (this.pressed('right') ? 1 : 0) - (this.pressed('left') ? 1 : 0),
      handbrake: this.pressed('handbrake'),
    }
  }
}
