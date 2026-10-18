// Start sequence dressing on the start/finish arch: two screens over the start model's blank panels
// (left the driftline logo, right the run timer over a READY / 3-2-1 / GO! band), a three-lamp start
// light on the approach face of each arch pillar, and the driftline logo plus a grid box painted on
// the road at the start. What they show comes from race.board() (src/race/start-board.ts), the same
// mapping as the HUD lights. All textures are drawn on a canvas here: no image assets.
import * as THREE from 'three/webgpu'
import type { Band, Lamp, StartBoard } from '../../race/start-board'
import { LAMPS } from '../../race/start-board'
import { gateLine, gatePillars, type Pose, type Track } from '../../track/schema'
import { anisotropy } from '../anisotropy'
import { flat } from '../tags'
import { planPieces } from './kenney-plan'
import { ZONE_LIFT } from './zones'

/**
 * The start model's two dark banner panels (assets/pieces/start.glb, piece-local metres): each spans
 * PANEL_X across, and leans toward the approaching car from (bottom y, z) to (top y, z).
 */
const PANEL_X = [1.29, 3.76] as const
const PANEL_BOTTOM = { y: 5.38, z: 9.65 }
const PANEL_TOP = { y: 6.51, z: 9.15 }
/** Screens float this far off the panel along its normal (plus polygonOffset), so they never z-fight it. */
const SCREEN_LIFT = 0.02

/** Start light: housing on each pillar's approach face, lamps top to bottom, above car height. */
const LIGHT = { width: 0.62, height: 1.75, depth: 0.16, centreY: 3.4, lampRadius: 0.22, lampStep: 0.55 } as const

/** Road paint: the logo between the grid box and the arch, and the grid box around the spawn. */
const ROAD_LOGO = { width: 6.4, length: 1.6, beforeLine: 4.5 } as const
const GRID_BOX = { width: 3.0, length: 5.0, line: 0.15 } as const

const BAND_COLOUR: Record<Band, string> = { ready: '#39404d', count: '#d61f1f', go: '#18b84a', finish: '#f2b705' }

export interface StartDressing {
  object: THREE.Group
  /** Show `board` on the lights and screens; redraws the timer texture only when its text changes. */
  update(board: StartBoard): void
}

const canvasTexture = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, THREE.CanvasTexture] => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('start dressing: no 2d canvas context')
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = anisotropy()
  return [canvas, ctx, tex]
}

/** The wordmark: white italic DRIFTLINE with a yellow underline, as on the trackside boards. */
const drawWordmark = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void => {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `italic 900 ${size}px system-ui, sans-serif`
  ctx.fillStyle = '#ffffff'
  ctx.fillText('DRIFTLINE', cx, cy)
  const w = size * 4 // underline under the middle of the word, from the font size (no measureText)
  ctx.fillStyle = '#ffd60a'
  ctx.fillRect(cx - w / 2, cy + size * 0.52, w, size * 0.12)
}

const logoScreenTexture = (): THREE.CanvasTexture => {
  const [c, ctx, tex] = canvasTexture(512, 256)
  ctx.fillStyle = '#0b2a6b'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#123f99'
  for (let x = -c.height; x < c.width; x += 56) {
    ctx.beginPath()
    ctx.moveTo(x, c.height)
    ctx.lineTo(x + 28, c.height)
    ctx.lineTo(x + 28 + c.height, 0)
    ctx.lineTo(x + c.height, 0)
    ctx.fill()
  }
  drawWordmark(ctx, c.width / 2, c.height * 0.44, 96)
  return tex
}

/** Quad over one banner panel, uv (0,0) at the bottom of the side the driver sees on the left. */
const panelGeometry = (screenLeftX: number, screenRightX: number): THREE.BufferGeometry => {
  const ny = PANEL_BOTTOM.z - PANEL_TOP.z // normal toward the car: (0, -dz, -dy) normalised
  const nz = -(PANEL_TOP.y - PANEL_BOTTOM.y)
  const n = Math.hypot(ny, nz)
  const oy = (-ny / n) * SCREEN_LIFT
  const oz = (nz / n) * SCREEN_LIFT
  const b = [PANEL_BOTTOM.y + oy, PANEL_BOTTOM.z + oz]
  const t = [PANEL_TOP.y + oy, PANEL_TOP.z + oz]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    screenLeftX, b[0], b[1], screenRightX, b[0], b[1], screenLeftX, t[0], t[1], screenRightX, t[0], t[1],
  ]), 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2))
  geo.setIndex([0, 1, 2, 2, 1, 3])
  geo.computeVertexNormals()
  return geo
}

const screenMaterial = (map: THREE.Texture) =>
  // Unlit and outside tone mapping: an LED board reads the same in sun and shade.
  new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })

// Lit lamps are unlit and outside tone mapping (like the screens): ACES would wash red to orange.
const lampMaterial = (lamp: Lamp): THREE.Material =>
  lamp === 'off'
    ? new THREE.MeshStandardMaterial({ color: 0x4a505c, roughness: 0.3 }) // unlit glass, a shade lighter than the housing so the three lamps read
    : new THREE.MeshBasicMaterial({ color: lamp === 'red' ? 0xff1a0a : 0x1aff5a, toneMapped: false })

/** Road-paint decal on the asphalt, centred `along` metres past `pose` along its heading. */
const roadDecal = (pose: Pose, along: number, geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
  const mesh = flat(new THREE.Mesh(geo, material), 'decal')
  mesh.position.set(pose.x + Math.sin(pose.heading) * along, pose.y + ZONE_LIFT, pose.z + Math.cos(pose.heading) * along)
  mesh.rotation.y = pose.heading
  mesh.receiveShadow = true
  return mesh
}

/** Flat rectangle in the xz plane, `w` across and `l` along, centred on the origin; uv u runs to the driver's right. */
const flatRect = (w: number, l: number, cx = 0, cz = 0): number[] => [
  cx + w / 2, 0, cz - l / 2, cx - w / 2, 0, cz - l / 2, cx + w / 2, 0, cz + l / 2,
  cx + w / 2, 0, cz + l / 2, cx - w / 2, 0, cz - l / 2, cx - w / 2, 0, cz + l / 2,
]

const DECAL = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, roughness: 0.6 } as const

/** Start dressing for `track`, or null when it has no start/finish gate. */
export const createStartDressing = (track: Track): StartDressing | null => {
  const gate = track.gates.find((g) => g.kind === 'start-finish')
  if (!gate) return null
  const object = new THREE.Group()
  object.name = 'start-dressing'

  // Screens: only the start model has the panels; a procedural arch (start on a curve) has none.
  let drawTimer: ((board: StartBoard) => void) | null = null
  const start = planPieces(track).placements.find((p) => p.piece === 'start')
  if (start) {
    const screens = new THREE.Group()
    screens.position.set(start.pose.x, start.pose.y, start.pose.z)
    screens.rotation.y = start.pose.heading
    screens.scale.set(...start.scale)
    // Facing the car, local +x is on the driver's left: the logo goes left, the timer right.
    screens.add(flat(new THREE.Mesh(panelGeometry(PANEL_X[1], PANEL_X[0]), screenMaterial(logoScreenTexture())), 'screen-face'))
    const [c, ctx, tex] = canvasTexture(512, 256)
    screens.add(flat(new THREE.Mesh(panelGeometry(-PANEL_X[0], -PANEL_X[1]), screenMaterial(tex)), 'screen-face'))
    object.add(screens)
    let shown = ''
    drawTimer = (board) => {
      const key = `${board.timer}|${board.band}|${board.bandText}`
      if (key === shown) return
      shown = key
      const split = Math.round(c.height * 0.66)
      ctx.fillStyle = '#0a0d14'
      ctx.fillRect(0, 0, c.width, split)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'italic 800 120px ui-monospace, Menlo, monospace'
      ctx.fillStyle = board.band === 'finish' ? '#ffd60a' : '#ffffff'
      ctx.fillText(board.timer, c.width / 2, split / 2 + 4)
      ctx.fillStyle = BAND_COLOUR[board.band]
      ctx.fillRect(0, split, c.width, c.height - split)
      ctx.font = 'italic 900 64px system-ui, sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(board.bandText, c.width / 2, split + (c.height - split) / 2 + 2)
      tex.needsUpdate = true
    }
  }

  // Start lights, one per pillar, on the face toward the approaching car, lamps above car height.
  const lampMaterials: Record<Lamp, THREE.Material> = { off: lampMaterial('off'), red: lampMaterial('red'), green: lampMaterial('green') }
  const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5 })
  const lampGeometry = new THREE.CircleGeometry(LIGHT.lampRadius, 24)
  const lamps: THREE.Mesh[][] = []
  for (const p of gatePillars(track, gate)) {
    const unit = new THREE.Group()
    // Local +z faces the car: the unit stands on the pillar's approach face, turned to look back down the road.
    unit.position.set(p.x - Math.sin(p.heading) * p.halfDepth, p.y + LIGHT.centreY, p.z - Math.cos(p.heading) * p.halfDepth)
    unit.rotation.y = p.heading + Math.PI
    const housing = new THREE.Mesh(new THREE.BoxGeometry(LIGHT.width, LIGHT.height, LIGHT.depth), housingMaterial)
    housing.position.z = LIGHT.depth / 2
    housing.castShadow = true
    unit.add(housing)
    const row: THREE.Mesh[] = []
    for (let i = 0; i < LAMPS; i++) {
      const lamp = flat(new THREE.Mesh(lampGeometry, lampMaterials.off), 'screen-face')
      lamp.position.set(0, LIGHT.lampStep * (1 - i), LIGHT.depth + 0.005)
      unit.add(lamp)
      row.push(lamp)
    }
    lamps.push(row)
    object.add(unit)
  }

  // Road paint: the logo between the grid box and the arch, the grid box around the spawn.
  const line = gateLine(track, gate)
  const [lc, lctx, ltex] = canvasTexture(1024, 256)
  drawWordmark(lctx, lc.width / 2, lc.height * 0.42, 150)
  const logoGeo = new THREE.BufferGeometry()
  logoGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flatRect(ROAD_LOGO.width, ROAD_LOGO.length)), 3))
  // Bottom of the text toward the approaching car, read left to right from the driver's seat.
  logoGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), 2))
  logoGeo.computeVertexNormals()
  const paint = new THREE.MeshStandardMaterial({ ...DECAL, map: ltex, opacity: 0.9 })
  object.add(roadDecal(line, -ROAD_LOGO.beforeLine, logoGeo, paint))

  const { width: w, length: l, line: t } = GRID_BOX
  const boxGeo = new THREE.BufferGeometry()
  boxGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    ...flatRect(w, t, 0, -l / 2 + t / 2), ...flatRect(w, t, 0, l / 2 - t / 2),
    ...flatRect(t, l, w / 2 - t / 2, 0), ...flatRect(t, l, -w / 2 + t / 2, 0),
  ]), 3))
  boxGeo.computeVertexNormals()
  const white = new THREE.MeshStandardMaterial({ ...DECAL, color: 0xf2f2f2, opacity: 0.9 })
  object.add(roadDecal({ ...track.start, y: line.y }, 0, boxGeo, white))

  return {
    object,
    update(board) {
      drawTimer?.(board)
      for (const row of lamps) row.forEach((lamp, i) => (lamp.material = lampMaterials[board.lamps[i]]))
    },
  }
}
