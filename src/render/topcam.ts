// `?cam=top`: debug camera straight above the track, framing the whole lap (README § Debug screenshots).
import type { Track } from '../track/schema'
import { centreline } from '../track/centreline'

export const topCamRequested = (search: string): boolean => new URLSearchParams(search).get('cam') === 'top'

export type TopCam = { x: number; y: number; z: number }

/** Camera point above the centreline's bounding-box centre, high enough that a `fovDeg` view at `aspect` fits it plus a 20 m margin. */
export const topCamFor = (track: Track, fovDeg: number, aspect: number): TopCam => {
  const line = centreline(track, 2)
  const xs = line.map((p) => p.x)
  const zs = line.map((p) => p.z)
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const margin = 20
  const halfV = (maxZ - minZ) / 2 + margin // screen-up is world -z, so z spans the vertical
  const halfH = (maxX - minX) / 2 + margin
  const tan = Math.tan(((fovDeg / 2) * Math.PI) / 180)
  const y = Math.max(halfV / tan, halfH / (tan * aspect))
  return { x: (minX + maxX) / 2, y, z: (minZ + maxZ) / 2 }
}
