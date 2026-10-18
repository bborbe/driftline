// Shared palette of the stadium look. The procedural road (track/mesh.ts), the Kenney pieces
// (track/kenney.ts) and the decor (decor/) all read their colours here, so a retint lands on every
// kind of road at once and the piece renderer and the decor never drift apart.
//
// The palette is cool blue, mint, white and charcoal, with one orange accent for the car, the timing
// and highlights. Whites stay at or below WHITE_MAX linear, so a sunlit barrier keeps its shading
// under ACES instead of clipping flat; the asphalt stays charcoal-dark, so the white lines read on it.
import * as THREE from 'three/webgpu'

const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)

/** Brightest linear albedo a white surface may have: above it, sunlit white clips under ACES. */
export const WHITE_MAX = 0.85

/** Dark, clean asphalt: the bright curbs, stripes and edge lines read against it at speed. */
export const ASPHALT = linear(0.075, 0.078, 0.085)
/** Curb stripe red and white (Trackmania-style alternating blocks); the white also paints the rails (track/rails.ts). */
export const CURB_RED = linear(0.75, 0.04, 0.04)
export const CURB_WHITE = linear(0.8, 0.81, 0.82)
/** Neon edge line on the rail tops (track/rails.ts): cyan, drawn emissive. */
export const NEON_CYAN = linear(0.05, 0.85, 1)
/** Sign boards: Trackmania yellow on near-black. */
export const SIGN_YELLOW = '#ffd21f'
export const SIGN_BLACK = '#141414'

/** Palette (sRGB): the cool blue of the sky and the stand structures. */
export const COOL_BLUE = '#3f7fbf'
/** Palette (sRGB): mint, for trackside props that would otherwise be pastel. */
export const MINT = '#5fc9a8'
/** Palette (sRGB): charcoal, for dark structure and trim. */
export const CHARCOAL = '#2a2e33'
/** Palette (sRGB): the one warm accent — the car, the timing and highlights. */
export const ACCENT_ORANGE = '#ff7a1a'
