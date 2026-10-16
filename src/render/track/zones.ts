// Turbo pads and surface patches (dirt, ice, grass) drawn as flat quads just above the road.
// Placement comes from zoneCorners() — the same fractions the physics reads materials from.
import * as THREE from 'three/webgpu'
import { zoneCorners, type Pose, type Track, type Zone, type ZoneKind } from '../../track/schema'

/** Drawn a little narrower than the physics patch (full TRACK_WIDTH), so the curbs stay visible. */
export const ZONE_WIDTH = 8.6
/** Lift above the road surface, enough to win the depth test against the Kenney tiles. */
export const ZONE_LIFT = 0.1

const LOOK: Record<ZoneKind, { color: number; emissive: number; roughness: number; metalness: number }> = {
  'turbo': { color: 0xffd60a, emissive: 0.5, roughness: 0.4, metalness: 0 },
  'turbo-red': { color: 0xff2a2a, emissive: 0.6, roughness: 0.4, metalness: 0 },
  dirt: { color: 0x8a5a2b, emissive: 0, roughness: 1, metalness: 0 },
  ice: { color: 0xcdeeff, emissive: 0.08, roughness: 0.05, metalness: 0.1 },
  grass: { color: 0x3f8f3a, emissive: 0, roughness: 1, metalness: 0 },
}

const lift = (p: Pose, dy: number): number[] => [p.x, p.y + dy, p.z]

const lerp = (a: Pose, b: Pose, t: number): Pose => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
  heading: a.heading,
})

/** Flat quad of a zone as triangle positions (two triangles). */
export const zoneQuad = (track: Track, zone: Zone, width = ZONE_WIDTH): Float32Array => {
  const [l0, r0, l1, r1] = zoneCorners(track, zone, width)
  return new Float32Array([...lift(l0, ZONE_LIFT), ...lift(r0, ZONE_LIFT), ...lift(l1, ZONE_LIFT), ...lift(r0, ZONE_LIFT), ...lift(r1, ZONE_LIFT), ...lift(l1, ZONE_LIFT)])
}

/** Forward-pointing chevrons on a turbo pad, as triangle positions slightly above its quad. */
export const turboChevrons = (track: Track, zone: Zone, count = 3, width = ZONE_WIDTH): Float32Array => {
  const [l0, r0, l1, r1] = zoneCorners(track, zone, width * 0.7)
  const out: number[] = []
  const dy = ZONE_LIFT + 0.03
  for (let i = 0; i < count; i++) {
    const a = (i + 0.15) / count
    const b = (i + 0.85) / count
    const left = lerp(l0, l1, a)
    const right = lerp(r0, r1, a)
    const tip = lerp(lerp(l0, r0, 0.5), lerp(l1, r1, 0.5), b)
    out.push(...lift(left, dy), ...lift(right, dy), ...lift(tip, dy))
  }
  return new Float32Array(out)
}

const mesh = (positions: Float32Array, material: THREE.Material): THREE.Mesh => {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, material)
  m.receiveShadow = true
  return m
}

export const createZoneMeshes = (track: Track): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'zones'
  const materials = new Map<ZoneKind, THREE.Material>()
  const materialFor = (kind: ZoneKind) => {
    if (!materials.has(kind)) {
      const look = LOOK[kind]
      materials.set(
        kind,
        new THREE.MeshStandardMaterial({
          color: look.color,
          emissive: look.color,
          emissiveIntensity: look.emissive,
          roughness: look.roughness,
          metalness: look.metalness,
          side: THREE.DoubleSide,
        }),
      )
    }
    return materials.get(kind)!
  }
  const chevron = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8, side: THREE.DoubleSide })
  for (const zone of track.zones ?? []) {
    group.add(mesh(zoneQuad(track, zone), materialFor(zone.kind)))
    if (zone.kind === 'turbo' || zone.kind === 'turbo-red') group.add(mesh(turboChevrons(track, zone), chevron))
  }
  return group
}
