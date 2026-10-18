// Anisotropic filtering for every road, ground and decor texture. view.ts sets the GPU's maximum once
// the renderer is up and before any texture is built; each texture site then reads `anisotropy()`, so
// the grass and asphalt stay sharp at the grazing angles a chase camera sees them at.

/** Highest anisotropy used, whatever the GPU offers: past 16 the gain is invisible. */
export const ANISOTROPY_CAP = 16
/** Before the renderer reports its maximum (and in headless tests): the level every site used before. */
const FALLBACK = 8

let level = FALLBACK

/** The level for a GPU maximum: capped, and never below 1. */
export const anisotropyFor = (gpuMax: number): number => Math.max(1, Math.min(ANISOTROPY_CAP, Math.floor(gpuMax) || 1))

/** Record the renderer's maximum (`renderer.getMaxAnisotropy()`). */
export const setMaxAnisotropy = (gpuMax: number): void => {
  level = anisotropyFor(gpuMax)
}

/** The anisotropy a texture should use now. */
export const anisotropy = (): number => level
