// Neon Night (time `neon`, src/track/environment.ts): everything the preset adds over the plain
// scene — the rail tubes, the skyline, the spark fountains, pink rims and the road reflection. Built
// once with the view and switched by visibility, so a live change to and from Neon Night costs nothing.
// The lighting, fog, bloom and grade come from render/environment.ts, glow.ts and view.ts.
// Visual only: nothing here reads or writes physics state.
import * as THREE from 'three/webgpu'
import type { Track } from '../../track/schema'
import { NEON_GLOW } from '../glow'
import { createRoadReflection, REFLECT_LAYER } from './reflection'
import { createSkyline } from './skyline'
import { createSparks } from './sparks'
import { createNeonTubes } from './tubes'

export { REFLECT_LAYER } from './reflection'

/**
 * Put every glowing mesh under `root` in the mirror pass: any material tagged with a glow class
 * (glow.ts — car lights, rims, tubes) and the rails' neon ribbon. Turbo pads and the white edge lines
 * lie on the road itself, so their mirror image would sit on top of them as a white smear: they stay out.
 */
export const markReflectable = (root: THREE.Object3D): void => {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (mesh.name === 'neon' || mats.some((m) => m.userData.glow && !ON_ROAD.has(m.userData.glow))) mesh.layers.enable(REFLECT_LAYER)
  })
}

/** Glow classes drawn on the road surface, kept out of the mirror pass. */
const ON_ROAD = new Set(['turbo-pad', 'edge-line'])

/** Edge-line glow in Neon Night, against its own: dimmed, so the white lines frame the road without washing the tubes out. */
export const NEON_EDGE_DIM = 0.4

type Glowing = THREE.MeshStandardMaterial & { userData: { glow?: string; ownRim?: number; ownGlow?: number } }

/** Neon Night's retint of the glow already in the scene: rims turn pink, edge lines dim. Off restores both. */
export const setNeonGlow = (root: THREE.Object3D, on: boolean): void => {
  const done = new Set<THREE.Material>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Glowing[]) {
      if (done.has(m)) continue
      done.add(m)
      if (m.userData.glow === 'rim') {
        m.userData.ownRim ??= m.color.getHex()
        const hex = on ? NEON_GLOW.rim : m.userData.ownRim
        m.color.setHex(hex)
        m.emissive.setHex(hex)
      } else if (m.userData.glow === 'edge-line') {
        m.userData.ownGlow ??= m.emissiveIntensity
        m.emissiveIntensity = m.userData.ownGlow * (on ? NEON_EDGE_DIM : 1)
      }
    }
  })
}

export type Neon = {
  /** Tubes, skyline and sparks; view.ts adds it (and the reflection target) to the scene. */
  object: THREE.Group
  /** The mirror plane's anchor. */
  reflectionTarget: THREE.Object3D
  /** Show or hide the preset's extras; the reflection follows `active && reflections`. */
  setActive: (active: boolean) => void
  /** Graphics → Reflections. */
  setReflections: (on: boolean) => void
  /** Per frame while active: spark flight at `time` (s), facing `camera`; the mirror at road height `groundY`. */
  update: (time: number, camera: THREE.Camera, groundY: number) => void
}

export const createNeon = (track: Track, trackMesh: THREE.Object3D): Neon => {
  const object = new THREE.Group()
  object.name = 'neon-night'
  const tubes = createNeonTubes(track)
  const skyline = createSkyline(track)
  const sparks = createSparks(track)
  object.add(tubes, skyline, sparks.object)
  markReflectable(object)
  const reflection = createRoadReflection(trackMesh)
  let active = false
  let reflections = false
  const apply = () => {
    object.visible = active
    reflection.setEnabled(active && reflections)
  }
  apply()
  return {
    object,
    reflectionTarget: reflection.target,
    setActive: (on) => {
      active = on
      apply()
    },
    setReflections: (on) => {
      reflections = on
      apply()
    },
    update: (time, camera, groundY) => {
      if (!active) return
      sparks.update(time, camera)
      reflection.follow(groundY)
    },
  }
}
