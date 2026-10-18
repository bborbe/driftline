// Colour grade: the last look step of the post pipeline (view.ts), all in linear light before tone
// mapping. A tint multiplies the scene (Neon Night's magenta push lives there), then saturation, then
// contrast as a power curve around mid grey (0.18). Grading before ACES keeps its highlight roll-off:
// a display-space contrast clamped sunlit whites flat (12k clipped pixels at noon on test1, not 174).
// The day presets share one grade that pulls the palette (look.ts) together; night stays ungraded and
// Neon Night keeps exactly the tint it shipped with.
// Pure data: view.ts turns it into TSL uniforms.

export type Grade = {
  /** Linear multiply before tone mapping. */
  tint: readonly [number, number, number]
  /** Saturation: 1 is unchanged. */
  saturation: number
  /** Contrast exponent around linear mid grey (0.18): 1 is unchanged. */
  contrast: number
}

/** Neon Night colour grade (linear, before tone mapping): a push toward magenta. */
export const NEON_GRADE: readonly [number, number, number] = [1.06, 0.9, 1.08]

export const NO_GRADE: Grade = { tint: [1, 1, 1], saturation: 1, contrast: 1 }

/**
 * Morning, noon and sunset: a touch more contrast and colour, so the charcoal asphalt, the white
 * barriers and the orange car separate instead of sitting in one pale haze; a faint cool tint keeps
 * the whites clean blue-white rather than cream.
 */
export const DAY_GRADE: Grade = { tint: [0.98, 1, 1.02], saturation: 1.12, contrast: 1.1 }

export const NEON: Grade = { tint: NEON_GRADE, saturation: 1, contrast: 1 }

/** The grade for an environment look (render/environment.ts): neon over night over day. */
export const gradeFor = (look: { night: boolean; neon: boolean }): Grade => (look.neon ? NEON : look.night ? NO_GRADE : DAY_GRADE)
