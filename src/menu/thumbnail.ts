// Top-down track outline for the start-screen cards, drawn from the centreline. Pure and tested.
import type { Pose } from '../track/schema'

/** SVG path data for the poses fitted into a size×size box with a margin, north up (−z at the top). */
export function outlinePath(points: Pose[], size: number, margin = 8): string {
  if (points.length === 0) return ''
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ, 1)
  const k = (size - 2 * margin) / span
  return points.map((p, i) => `${i ? 'L' : 'M'}${(margin + (p.x - minX) * k).toFixed(1)} ${(margin + (p.z - minZ) * k).toFixed(1)}`).join(' ')
}
