// Stable id of a track's layout, the key per-layout records are stored under.
import type { Track } from './schema'

/**
 * Short stable id of a track's layout (start, segments, gates; not its name). Changes whenever
 * the geometry or gates change, so per-layout records start fresh after a redesign. FNV-1a, 8 hex.
 */
export function layoutId(track: Track): string {
  // Zones and barriers join the key only when present, so tracks without any keep their original id.
  const parts: unknown[] = [track.start, track.segments, track.gates]
  if (track.zones?.length) parts.push(track.zones)
  if (track.barriers?.length) parts.push({ barriers: track.barriers })
  const text = JSON.stringify(parts)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
