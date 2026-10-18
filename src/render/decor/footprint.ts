// Plan-view footprints for trackside props: an upright box seen from above, so a planner can keep
// one prop out of another. Pure.

/** A rectangle centred on (x, z), turned by `heading` like placement() (local +z faces it), half sizes hx across and hz along. */
export type Footprint = { x: number; z: number; heading: number; hx: number; hz: number }

/** Half the footprint's extent along the unit axis (ax, az). */
const extent = (f: Footprint, ax: number, az: number): number =>
  Math.abs(f.hx * (Math.cos(f.heading) * ax - Math.sin(f.heading) * az)) + Math.abs(f.hz * (Math.sin(f.heading) * ax + Math.cos(f.heading) * az))

/** True when the two footprints overlap (separating-axis test over both rectangles' axes); touching is not overlapping. */
export const footprintsOverlap = (a: Footprint, b: Footprint): boolean => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  for (const h of [a.heading, b.heading]) {
    for (const [ax, az] of [
      [Math.cos(h), -Math.sin(h)],
      [Math.sin(h), Math.cos(h)],
    ]) {
      if (Math.abs(dx * ax + dz * az) >= extent(a, ax, az) + extent(b, ax, az)) return false
    }
  }
  return true
}
