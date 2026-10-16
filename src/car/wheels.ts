// Wheel node names inside the car model, keyed by corner. The renderer steers
// fl/fr and spins all four; physics raycasts from the same corners.
export const CAR_MODEL = 'assets/car-kit/race.glb'

export type Corner = 'fl' | 'fr' | 'rl' | 'rr'

export const WHEEL_NODES: Record<Corner, string> = {
  fl: 'wheel-front-left',
  fr: 'wheel-front-right',
  rl: 'wheel-back-left',
  rr: 'wheel-back-right',
}

export const STEERED: readonly Corner[] = ['fl', 'fr']
