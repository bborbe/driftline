// Shared palette of the stadium look. The procedural road (track/mesh.ts), the Kenney pieces
// (track/kenney.ts) and the decor (decor/) all read their colours here, so a retint lands on every
// kind of road at once and the piece renderer and the decor never drift apart.
import * as THREE from 'three/webgpu'

const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)

/** Dark, clean asphalt: the bright curbs, stripes and edge lines read against it at speed. */
export const ASPHALT = linear(0.075, 0.078, 0.085)
/** Curb stripe red and white (Trackmania-style alternating blocks). */
export const CURB_RED = linear(0.75, 0.04, 0.04)
export const CURB_WHITE = linear(0.92, 0.92, 0.92)
/** Sign boards: Trackmania yellow on near-black. */
export const SIGN_YELLOW = '#ffd21f'
export const SIGN_BLACK = '#141414'
