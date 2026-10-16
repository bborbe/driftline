// Stadium backdrop: a ring of grandstands, banner towers, floodlights and big screens around the
// whole lap, well outside the scenery, so the track sits in an arena instead of an empty field.
// Kenney Racing Kit models (CC0, assets/LICENSES/kenney-racing-kit.txt) plus original canvas screens;
// placement is a pure planner (unit-tested), createStadium() bakes it all into two meshes.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { centreline } from '../../track/centreline'
import type { Track } from '../../track/schema'
import { bakeModel, merged, placement, prepared } from './instance'

const MODEL_URLS = import.meta.glob('/assets/racing-kit/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>

export const STADIUM_MODELS = ['grandStandCovered', 'grandStand', 'bannerTowerRed', 'bannerTowerGreen', 'lightPostLarge'] as const
export type StadiumModel = (typeof STADIUM_MODELS)[number] | 'screen'

/** One backdrop object on the ground (y 0), facing `heading` (0 = +z) — toward the track. */
export type StadiumProp = { model: StadiumModel; x: number; z: number; heading: number; scale: number }

/** The ring stands this far outside the lap's bounding box: past every tree (scenery.ts, ≤ 45 m). */
export const STADIUM_GAP = 65
/** Centre-to-centre distance of the slots along each side of the ring. */
export const SLOT = 30
/** Model scales (the Kenney models are about 1 unit): a ~24 m stand, ~17 m towers, ~26 m lights. */
const SCALE: Record<StadiumModel, number> = {
  grandStandCovered: 24,
  grandStand: 24,
  bannerTowerRed: 14,
  bannerTowerGreen: 14,
  lightPostLarge: 32,
  screen: 1,
}
/** Every this many slots along a side is a big screen instead of a stand. */
const SCREEN_EVERY = 4

export const planStadium = (track: Track): StadiumProp[] => {
  const line = centreline(track, 4)
  const minX = Math.min(...line.map((p) => p.x)) - STADIUM_GAP
  const maxX = Math.max(...line.map((p) => p.x)) + STADIUM_GAP
  const minZ = Math.min(...line.map((p) => p.z)) - STADIUM_GAP
  const maxZ = Math.max(...line.map((p) => p.z)) + STADIUM_GAP
  // Four sides, each from one corner to the next, facing inward: heading 0 faces +z.
  const sides = [
    { from: [minX, minZ], to: [maxX, minZ], heading: 0 },
    { from: [maxX, minZ], to: [maxX, maxZ], heading: -Math.PI / 2 },
    { from: [maxX, maxZ], to: [minX, maxZ], heading: Math.PI },
    { from: [minX, maxZ], to: [minX, minZ], heading: Math.PI / 2 },
  ]
  const props: StadiumProp[] = []
  const add = (model: StadiumModel, x: number, z: number, heading: number) => props.push({ model, x, z, heading, scale: SCALE[model] })
  for (const [k, { from, to, heading }] of sides.entries()) {
    add('lightPostLarge', from[0], from[1], heading + Math.PI / 4) // the corner, angled into the arena
    const len = Math.hypot(to[0] - from[0], to[1] - from[1])
    const slots = Math.max(1, Math.floor((len - SLOT) / SLOT))
    const gap = len / (slots + 1)
    for (let i = 1; i <= slots; i++) {
      const f = (i * gap) / len
      const x = from[0] + (to[0] - from[0]) * f
      const z = from[1] + (to[1] - from[1]) * f
      const middle = i === Math.ceil(slots / 2)
      add(middle || i % SCREEN_EVERY === 0 ? 'screen' : i % 2 === 0 ? 'grandStand' : 'grandStandCovered', x, z, heading)
      // A banner tower in the gap before each slot, alternating colours around the ring.
      const g = ((i - 0.5) * gap) / len
      add((i + k) % 2 === 0 ? 'bannerTowerRed' : 'bannerTowerGreen', from[0] + (to[0] - from[0]) * g, from[1] + (to[1] - from[1]) * g, heading)
    }
  }
  return props
}

/** Big screen: board size and the height of its lower edge, in metres. */
export const SCREEN = { width: 26, height: 10, bottom: 9, depth: 1 } as const

/** Original screen art: the game's name over diagonal stripes. No third-party branding. */
const screenTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 394
  const g = canvas.getContext('2d')!
  const bg = g.createLinearGradient(0, 0, 1024, 394)
  bg.addColorStop(0, '#062a4a')
  bg.addColorStop(1, '#0b5f8a')
  g.fillStyle = bg
  g.fillRect(0, 0, 1024, 394)
  g.fillStyle = 'rgba(54, 214, 231, 0.35)'
  for (let i = -2; i < 8; i++) {
    g.beginPath()
    g.moveTo(i * 160, 394)
    g.lineTo(i * 160 + 70, 394)
    g.lineTo(i * 160 + 230, 0)
    g.lineTo(i * 160 + 160, 0)
    g.fill()
  }
  g.fillStyle = '#ffffff'
  g.font = 'italic 900 150px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('DRIFTLINE', 512, 175)
  g.fillStyle = '#ffd21f'
  g.fillRect(262, 270, 500, 14)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * Kenney models' fronts (the stands' seats) already look toward +z, so `heading` applies as is.
 * Screens: a dark box on two legs (baked with the models) and a printed plane on its front.
 */
const dark = new THREE.Color(0x1f2226)

const screenParts = (props: StadiumProp[]): { body: THREE.BufferGeometry[]; faces: THREE.BufferGeometry[] } => {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const face = new THREE.PlaneGeometry(SCREEN.width - 0.6, SCREEN.height - 0.6)
  const body: THREE.BufferGeometry[] = []
  const faces: THREE.BufferGeometry[] = []
  for (const p of props) {
    const at = placement(p.x, 0, p.z, p.heading)
    const local = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      new THREE.Matrix4().multiplyMatrices(at, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)))
    body.push(prepared(box, dark, local(0, SCREEN.bottom + SCREEN.height / 2, 0, SCREEN.width, SCREEN.height, SCREEN.depth)))
    for (const x of [-SCREEN.width / 3, SCREEN.width / 3]) body.push(prepared(box, dark, local(x, SCREEN.bottom / 2, -SCREEN.depth, 1.2, SCREEN.bottom, 1.2)))
    faces.push(prepared(face, new THREE.Color(1, 1, 1), local(0, SCREEN.bottom + SCREEN.height / 2, SCREEN.depth / 2 + 0.02, 1, 1, 1), (u, v) => [u, v]))
  }
  return { body, faces }
}

export const createStadium = async (track: Track): Promise<THREE.Group> => {
  const loader = new GLTFLoader()
  const props = planStadium(track)
  const parts = await Promise.all(
    STADIUM_MODELS.map(async (m) => {
      const url = MODEL_URLS[`/assets/racing-kit/${m}.glb`]
      if (!url) throw new Error(`no asset for stadium model "${m}"`)
      const root = (await loader.loadAsync(url)).scene
      return bakeModel(root, props.filter((p) => p.model === m).map((p) => placement(p.x, 0, p.z, p.heading, p.scale)))
    }),
  )
  const screens = screenParts(props.filter((p) => p.model === 'screen'))
  const group = new THREE.Group()
  group.name = 'stadium'
  // Two draw calls for the whole arena. Fully rough (still lit by the HDRI, unlike Lambert, which
  // left every shaded side black), and no shadows: it stands far outside the car's shadow frustum
  // (scene.ts, ±60 m).
  group.add(merged([...parts.flat(), ...screens.body], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })))
  group.add(merged(screens.faces, new THREE.MeshBasicMaterial({ map: screenTexture() })))
  return group
}
