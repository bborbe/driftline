// Trackside dressing meshes: brake boards (100 / 50), corner-number boards, "driftline motorsport"
// banners, marshal posts, catch fences and grass/terrain colour patches. This module only builds
// geometry from a TracksidePlan; where things stand is the pure planner's job (planTrackside). Boards
// and banners print from one canvas atlas and bake into one mesh; posts and fences bake into a second
// vertex-coloured mesh; patches are flat decals over the ground. Visual only: physics never sees them.
import * as THREE from 'three/webgpu'
import { SIGN_BLACK, SIGN_YELLOW } from '../look'
import { flat, noCollide, structural } from '../tags'
import { merged, placement, prepared } from './instance'

/** A printed board standing at (x, y, z), its face looking toward `heading` (0 = +z). */
export type Board = { kind: 'brake-100' | 'brake-50' | 'corner'; label: number; x: number; y: number; z: number; heading: number }
/** A banner hoarding centred on (x, y, z), `length` metres long, face toward `heading`. */
export type Banner = { variant: 0 | 1; x: number; y: number; z: number; heading: number; length: number }
/** A marshal post: a small booth with a flag pole, front toward `heading`. */
export type MarshalPost = { x: number; y: number; z: number; heading: number }
/** A catch fence along `points` (x, z), standing on height `y`. */
export type Fence = { y: number; points: [number, number][] }
/** A ground colour patch: an irregular blob of radius ~`radius`, `shade` of the ground colour. */
export type Patch = { x: number; z: number; radius: number; heading: number; shade: 'dark' | 'light' | 'dirt' }

export type TracksidePlan = { boards: Board[]; banners: Banner[]; marshals: MarshalPost[]; fences: Fence[]; patches: Patch[] }

/** Board sizes in metres, lower edge `bottom` above the ground. Every part stays above MIN_THICKNESS (lint.ts). */
export const BRAKE_BOARD = { width: 1.5, height: 1.5, depth: 0.16, bottom: 0.5 } as const
export const CORNER_BOARD = { width: 1.4, height: 1.4, depth: 0.16, bottom: 1.6 } as const
export const BANNER = { height: 1.1, depth: 0.16, bottom: 0.3 } as const
export const MARSHAL = { width: 2, height: 2.4, depth: 2, pole: 4.2 } as const
export const FENCE = { height: 2.6, post: 0.16, spacing: 3, rails: [0.5, 1.5, 2.5] } as const
/** Corner numbers printed in the atlas; a higher corner gets no number board. */
export const MAX_CORNER_LABEL = 24

// Atlas: 512 px wide, rows 128 px tall. Row 0: the 100 and 50 boards (256 px each). Rows 1..6: corner
// numbers 1..24, four 128 px cells per row. Rows 7, 8: the two banner variants. Row 9: frame colour.
const W = 512
const ROW = 128
const CORNER_ROWS = MAX_CORNER_LABEL / 4
const BANNER_ROW = 1 + CORNER_ROWS
const FRAME_ROW = BANNER_ROW + 2
const ROWS = FRAME_ROW + 1
const FRAME = '#1c1c1c'

/** A cell in canvas pixels: x, y (top), width, height. */
type Cell = [number, number, number, number]
export const atlasCell = (face: { kind: Board['kind'] | 'banner'; label: number }): Cell | undefined => {
  if (face.kind === 'brake-100') return [0, 0, 256, ROW]
  if (face.kind === 'brake-50') return [256, 0, 256, ROW]
  if (face.kind === 'banner') return face.label === 0 || face.label === 1 ? [0, (BANNER_ROW + face.label) * ROW, W, ROW] : undefined
  if (!Number.isInteger(face.label) || face.label < 1 || face.label > MAX_CORNER_LABEL) return undefined
  const k = face.label - 1
  return [(k % 4) * 128, (1 + Math.floor(k / 4)) * ROW, 128, ROW]
}

const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string) => {
  g.fillStyle = colour
  g.font = `italic 900 ${size}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(s, x, y)
}

/** Brake board: white, a red border, black distance. Corner number: accent board, black number. */
const drawAtlas = (g: CanvasRenderingContext2D, accent: string) => {
  for (const [label, x] of [
    ['100', 0],
    ['50', 256],
  ] as const) {
    g.fillStyle = '#f4f4f4'
    g.fillRect(x, 0, 256, ROW)
    g.strokeStyle = '#d0211a'
    g.lineWidth = 14
    g.strokeRect(x + 10, 10, 236, ROW - 20)
    text(g, label, x + 128, ROW / 2 + 4, 84, SIGN_BLACK)
  }
  for (let n = 1; n <= MAX_CORNER_LABEL; n++) {
    const [x, y, w, h] = atlasCell({ kind: 'corner', label: n })!
    g.fillStyle = accent
    g.fillRect(x, y, w, h)
    g.strokeStyle = SIGN_BLACK
    g.lineWidth = 8
    g.strokeRect(x + 6, y + 6, w - 12, h - 12)
    text(g, String(n), x + w / 2, y + h / 2 + 4, 76, SIGN_BLACK)
  }
  // Banners: the fictional series' own identity, no third-party branding.
  const banners: [string, string, string][] = [
    ['#0b2e4f', '#ffffff', SIGN_YELLOW],
    [SIGN_YELLOW, SIGN_BLACK, '#d0211a'],
  ]
  banners.forEach(([bg, fg, stripe], i) => {
    const y = (BANNER_ROW + i) * ROW
    g.fillStyle = bg
    g.fillRect(0, y, W, ROW)
    g.fillStyle = stripe
    g.fillRect(0, y + ROW - 18, W, 10)
    text(g, 'DRIFTLINE', 160, y + 54, 64, fg)
    text(g, 'MOTORSPORT', 390, y + 58, 40, stripe)
  })
  g.fillStyle = FRAME
  g.fillRect(0, FRAME_ROW * ROW, W, ROW)
}

const atlasTexture = (accent: string): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = ROWS * ROW
  drawAtlas(canvas.getContext('2d')!, accent)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** A cell's (u, v) in 0..1 mapped into atlas uv space: flipY puts the canvas top at v = 1. */
const cellUv = ([x, y, w, h]: Cell, u: number, v: number): [number, number] => [(x + u * w) / W, 1 - (y + (1 - v) * h) / (ROWS * ROW)]
const FRAME_UV = cellUv([0, FRAME_ROW * ROW, W, ROW], 0.5, 0.5)
/** BoxGeometry faces are +x, -x, +y, -y, +z, -z, six vertices each once non-indexed: +z is the front. */
const FRONT = [24, 30]

const white = new THREE.Color(1, 1, 1)
const unitBox = new THREE.BoxGeometry(1, 1, 1)

/** A box in a placed frame: local centre (x, y, z), size (sx, sy, sz). */
const local = (at: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
  new THREE.Matrix4().multiplyMatrices(at, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)))

/** A printed panel `w`×`h` with lower edge `bottom`, on two posts from the ground behind it. */
const panel = (parts: THREE.BufferGeometry[], cell: Cell, x: number, y: number, z: number, heading: number, w: number, h: number, depth: number, bottom: number, posts: number) => {
  const at = placement(x, y, z, heading)
  const uv = (u: number, v: number, i: number): [number, number] => (i >= FRONT[0] && i < FRONT[1] ? cellUv(cell, u, v) : FRAME_UV)
  parts.push(prepared(unitBox, white, local(at, 0, bottom + h / 2, 0, w, h, depth), uv))
  const top = bottom + h
  const post = 0.16
  for (let k = 0; k < posts; k++) {
    const px = posts === 1 ? 0 : -w / 2 + post + (k * (w - 2 * post)) / (posts - 1)
    parts.push(prepared(unitBox, white, local(at, px, top / 2, -(depth / 2 + post / 2), post, top, post), () => FRAME_UV))
  }
}

const boardParts = (plan: TracksidePlan): THREE.BufferGeometry[] => {
  const parts: THREE.BufferGeometry[] = []
  for (const b of plan.boards) {
    const cell = atlasCell(b)
    if (!cell) continue
    const size = b.kind === 'corner' ? CORNER_BOARD : BRAKE_BOARD
    panel(parts, cell, b.x, b.y, b.z, b.heading, size.width, size.height, size.depth, size.bottom, b.kind === 'corner' ? 1 : 2)
  }
  for (const b of plan.banners) {
    panel(parts, atlasCell({ kind: 'banner', label: b.variant })!, b.x, b.y, b.z, b.heading, b.length, BANNER.height, BANNER.depth, BANNER.bottom, Math.max(2, Math.ceil(b.length / 3)))
  }
  return parts
}

const BOOTH = new THREE.Color(0xe6e6e6)
const ROOF = new THREE.Color(0x2a6fb0)
const FLAG = new THREE.Color(0xff7a00)
const STEEL = new THREE.Color(0x8a939c)

const structureParts = (plan: TracksidePlan): THREE.BufferGeometry[] => {
  const parts: THREE.BufferGeometry[] = []
  for (const m of plan.marshals) {
    const at = placement(m.x, m.y, m.z, m.heading)
    parts.push(prepared(unitBox, BOOTH, local(at, 0, MARSHAL.height / 2, 0, MARSHAL.width, MARSHAL.height, MARSHAL.depth)))
    parts.push(prepared(unitBox, ROOF, local(at, 0, MARSHAL.height + 0.15, 0.2, MARSHAL.width + 0.6, 0.3, MARSHAL.depth + 0.8)))
    // The flag pole stands beside the booth from the ground, the flag near its top.
    const px = MARSHAL.width / 2 + 0.4
    parts.push(prepared(unitBox, STEEL, local(at, px, MARSHAL.pole / 2, 0, 0.16, MARSHAL.pole, 0.16)))
    parts.push(prepared(unitBox, FLAG, local(at, px + 0.5, MARSHAL.pole - 0.5, 0, 0.9, 0.6, 0.16)))
  }
  for (const f of plan.fences) {
    for (let i = 0; i + 1 < f.points.length; i++) {
      const [x0, z0] = f.points[i]
      const [x1, z1] = f.points[i + 1]
      const len = Math.hypot(x1 - x0, z1 - z0)
      if (len < 0.5) continue
      // Local +x runs along the run: heading turns +z to (sin h, cos h), so +x is (cos h, -sin h).
      const heading = Math.atan2(-(z1 - z0), x1 - x0)
      const at = placement((x0 + x1) / 2, f.y, (z0 + z1) / 2, heading)
      for (const r of FENCE.rails) parts.push(prepared(unitBox, STEEL, local(at, 0, r, 0, len, FENCE.post, FENCE.post)))
      const posts = Math.max(1, Math.round(len / FENCE.spacing))
      for (let k = 0; k <= posts; k++) {
        if (k === posts && i + 2 < f.points.length) continue // the next span's first post stands here
        parts.push(prepared(unitBox, STEEL, local(at, -len / 2 + (k * len) / posts, FENCE.height / 2, 0, FENCE.post, FENCE.height, FENCE.post)))
      }
    }
  }
  return parts
}

/** Patch colours as a factor of the ground colour (dark, light), or a fixed dry-earth brown. */
const PATCH_SHADE = { dark: 0.78, light: 1.18 } as const
const DIRT = new THREE.Color(0x8a6d48)

/** An irregular 9-sided blob of radius ~1, lying in the x/z plane, normal up. */
const blob = (seed: number): THREE.BufferGeometry => {
  const n = 9
  const pts: THREE.Vector2[] = []
  for (let k = 0; k < n; k++) {
    const r = 0.75 + 0.25 * Math.sin(seed * 12.9898 + k * 78.233)
    const a = (k / n) * Math.PI * 2
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r))
  }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts))
  g.rotateX(-Math.PI / 2)
  return g
}

/** Patches sit this far over the ground (y 0), well under the road top. */
export const PATCH_LIFT = 0.02

const patchMesh = (plan: TracksidePlan, ground: THREE.ColorRepresentation): THREE.Mesh | undefined => {
  if (plan.patches.length === 0) return undefined
  const base = new THREE.Color(ground)
  const parts = plan.patches.map((p, i) => {
    const colour = p.shade === 'dirt' ? DIRT : base.clone().multiplyScalar(PATCH_SHADE[p.shade])
    return prepared(blob(i + 1), colour, placement(p.x, PATCH_LIFT, p.z, p.heading, [p.radius, 1, p.radius]))
  })
  // Over the ground (renderOrder -1, no depth write) and under everything else; never in the depth buffer.
  const mesh = merged(parts, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
  mesh.renderOrder = -0.5
  mesh.receiveShadow = true
  mesh.name = 'terrain-patches'
  return flat(mesh, 'terrain')
}

/** Every trackside piece of `plan`: corner boards print on `accent` (a theme's `sign`), patches shade `ground`. */
export const createTrackside = (plan: TracksidePlan, accent: string = SIGN_YELLOW, ground: THREE.ColorRepresentation = '#7fc25a'): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'trackside'
  const boards = boardParts(plan)
  if (boards.length > 0) {
    const atlas = atlasTexture(accent)
    const mesh = merged(boards, new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8 }))
    mesh.name = 'trackside-boards'
    mesh.castShadow = true
    group.add(noCollide(structural(mesh, 'sign'), 'roadside-sign'))
  }
  const structures = structureParts(plan)
  if (structures.length > 0) {
    const mesh = merged(structures, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }))
    mesh.name = 'trackside-structures'
    mesh.castShadow = mesh.receiveShadow = true
    group.add(noCollide(structural(mesh, 'stand'), 'trackside'))
  }
  const patches = patchMesh(plan, ground)
  if (patches) group.add(patches)
  return group
}
