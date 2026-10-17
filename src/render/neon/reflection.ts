// Neon Night road reflection: a planar mirror at the road height under the car, added to every road
// material's emission, so the neon tubes, edge lines, skyline, sparks and the car's own lights and rims
// mirror on the asphalt. Cheap by construction: the mirror pass renders only REFLECT_LAYER (the glowing
// things) at half resolution, never the stadium, scenery or road. The plane follows the car's ground
// height, so the reflection is right where it is looked at; on slopes away from the car it drifts, which
// at this strength reads as a wet sheen. Graphics → Reflections (`refl=`) switches it; it is off by default, since
// it costs Neon Night more than the 15% fps budget against night (measured in PR: neon 84% of night with it,
// 93% without).
import * as THREE from 'three/webgpu'
import { float, normalView, positionViewDirection, reflector } from 'three/tsl'

/** Layer of the objects the mirror pass draws (layer 0 is everything the main camera draws). */
export const REFLECT_LAYER = 3
/** Mirror pass resolution against the canvas. */
export const REFLECT_RESOLUTION = 0.5
/** Reflection strength looking straight down, and the extra at a grazing angle (Fresnel). */
export const REFLECT_STRENGTH = { base: 0.55, grazing: 0.8 } as const

/** Put `root` and every object under it in the mirror pass, as well as the main view. */
export const reflectable = <T extends THREE.Object3D>(root: T): T => {
  root.traverse((o) => o.layers.enable(REFLECT_LAYER))
  return root
}

type Emissive = THREE.Material & { emissiveNode: unknown }

/** Every road material under `root` (materials named `road`, as view.ts setWetRoad finds them). */
export const roadMaterials = (root: THREE.Object3D): Emissive[] => {
  const out = new Set<Emissive>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.name === 'road') out.add(m as Emissive)
  })
  return [...out]
}

export type RoadReflection = {
  /** The mirror plane's anchor; view.ts adds it to the scene. */
  target: THREE.Object3D
  /** Mirror on or off; off restores each road material's own emission. */
  setEnabled: (on: boolean) => void
  /** Move the mirror plane to the road height `y` under the car. */
  follow: (y: number) => void
}

export const createRoadReflection = (trackMesh: THREE.Object3D): RoadReflection => {
  const mirror = reflector({ resolutionScale: REFLECT_RESOLUTION, bounces: false })
  const target = mirror.target
  target.name = 'neon-reflection'
  target.rotation.x = -Math.PI / 2 // the reflector faces +z; turn it to face up
  // The mirror's own camera sees only REFLECT_LAYER: the base node builds it on first use.
  const base = mirror.reflector as unknown as { getVirtualCamera: (c: THREE.Camera) => THREE.Camera }
  const virtualCamera = base.getVirtualCamera.bind(base)
  base.getVirtualCamera = (camera) => {
    const v = virtualCamera(camera)
    v.layers.set(REFLECT_LAYER)
    return v
  }
  const fresnel = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(3)
  const node = mirror.rgb.mul(fresnel.mul(REFLECT_STRENGTH.grazing).add(REFLECT_STRENGTH.base))
  const roads = roadMaterials(trackMesh)
  const own = new Map(roads.map((m) => [m, m.emissiveNode]))
  let enabled = false
  const setEnabled = (on: boolean) => {
    if (on === enabled) return
    enabled = on
    for (const m of roads) {
      m.emissiveNode = on ? node : own.get(m)
      m.needsUpdate = true
    }
  }
  const follow = (y: number) => {
    target.position.y = y
    target.updateMatrixWorld()
  }
  return { target, setEnabled, follow }
}
