// Contact shadow: a soft dark blob on the road under the car, so the body sits on the asphalt
// instead of floating over it. The sun's shadow map draws the car's cast shadow, but at a chase
// camera's distance and with the sun high that shadow is a thin offset sliver; the blob is the
// ambient occlusion where the tyres meet the road. It copies the car mesh's pose each frame (banks,
// loops, wallrides) and fades as the body lifts off the road, so a jump leaves it behind. Like the
// drift glow it is not a child of the car: the first livery paint repaints every mesh under the car.
// Visual only: reads the car's pose and the road gap, writes nothing.
import * as THREE from 'three/webgpu'
import { flat } from '../tags'
import { ROAD_TOP } from '../track/zones'

/** Opacity with the tyres on the road. */
export const CONTACT_SHADOW_OPACITY = 0.75
/** Gap (m) between body and road above ride height at which the blob has faded out. */
export const CONTACT_SHADOW_FADE = 2
/** Chassis origin above the road at rest (view.ts RIDE_HEIGHT): a road this far below is a body on its wheels. */
export const CONTACT_RIDE_HEIGHT = 0.68
/** Above the drawn asphalt, which sits ROAD_TOP over the surface the physics ray hits (decal rule: + 3 mm). */
const LIFT = ROAD_TOP + 0.003
/** Footprint (m): a little wider and longer than the body, so the soft edge shows around it. */
const WIDTH = 2.9
const LENGTH = 6.2

/** Opacity for the road `distance` (m) below the body origin, or null with no road: full on the wheels, none from FADE above. */
export const contactShadowOpacity = (distance: number | null): number =>
  distance === null ? 0 : CONTACT_SHADOW_OPACITY * Math.min(1, Math.max(0, 1 - Math.max(0, distance - CONTACT_RIDE_HEIGHT) / CONTACT_SHADOW_FADE))

const blobTexture = (): THREE.Texture => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, '#fff')
  r.addColorStop(0.5, '#bbb')
  r.addColorStop(1, '#000')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export type ContactShadow = {
  object: THREE.Object3D
  material: THREE.MeshBasicMaterial
  /** `car` is the car mesh root after its update; `distance` the road below its origin along its own down axis (null: none). */
  update: (car: THREE.Object3D, distance: number | null) => void
}

export const createContactShadow = (): ContactShadow => {
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: typeof document === 'undefined' ? null : blobTexture(),
    transparent: true,
    opacity: CONTACT_SHADOW_OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    fog: true,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, LENGTH), material)
  mesh.name = 'contact-shadow'
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 1 // after the road, before the car's transparent glass and the glow
  const root = new THREE.Group()
  root.name = 'contact-shadow-root'
  root.add(flat(mesh, 'decal'))
  const update = (car: THREE.Object3D, distance: number | null) => {
    material.opacity = contactShadowOpacity(distance)
    root.visible = distance !== null && material.opacity > 0 && car.visible
    if (root.visible) {
      root.position.copy(car.position)
      root.quaternion.copy(car.quaternion)
      mesh.position.y = LIFT - distance! // on the asphalt over the road the ray found, whatever the suspension is doing
    }
  }
  return { object: root, material, update }
}
