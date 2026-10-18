// Trackside dressing: flag rows along the straights and, near the start, two totems and a big start
// screen, so the lap reads as a stadium circuit and not a road across a field. Placement is a pure
// planner (unit-tested); createDressing() bakes the poles, totems and screen into one mesh over a
// canvas atlas and the flag cloth into a second. Visual only: physics never sees any of it.
import * as THREE from 'three/webgpu'
import { centreline } from '../../track/centreline'
import { DECK_DEPTH } from '../../track/bodies'
import { poses, sampleSegment, segmentLength, widthAt, type Track } from '../../track/schema'
import { anisotropy } from '../anisotropy'
import { flat, noCollide, structural } from '../tags'
import { footprintsOverlap, type Footprint } from './footprint'
import { merged, placement, prepared } from './instance'

/** A prop's footprint in plan: the pole with its cloth off to the right, a totem, the screen with its legs behind. */
export const dressingFootprint = (p: DressingProp): Footprint => {
  const at = (lx: number, lz: number, hx: number, hz: number): Footprint => ({
    x: p.x + lx * Math.cos(p.heading) + lz * Math.sin(p.heading),
    z: p.z - lx * Math.sin(p.heading) + lz * Math.cos(p.heading),
    heading: p.heading,
    hx,
    hz,
  })
  if (p.kind === 'flag') return at(CLOTH.width / 2, 0, POLE.size / 2 + CLOTH.width / 2, POLE.size / 2)
  if (p.kind === 'totem') return at(0, 0, TOTEM.width / 2, TOTEM.depth / 2)
  const back = START_SCREEN.depth / 2 + START_SCREEN.leg
  return at(0, (START_SCREEN.depth / 2 - back) / 2, START_SCREEN.width / 2, (START_SCREEN.depth / 2 + back) / 2)
}

/** A run of straight road at least this long carries a flag row. */
export const FLAG_RUN = 30
/** Flag poles stand this far past the road edge — behind the edge rail (track/rails.ts) — this far apart. */
export const FLAG_EDGE = 4
export const FLAG_STEP = 8
/** Pole and cloth sizes, in metres; the pole stays above MIN_THICKNESS (render/lint.ts). */
export const POLE = { size: 0.16, height: 6 } as const
export const CLOTH = { width: 1.4, height: 0.9 } as const

/** Totems and the start screen stand within this distance of the start, on the ground beside the road. */
export const START_REACH = 60
/** A start prop whose spot is taken tries these offsets along the lap, in metres, in turn. */
export const START_SLIDE: readonly number[] = [0, 5, -5, 10, -10, 15, -15, 20, -20, 25, -25]
export const TOTEM = { width: 2.4, height: 8, depth: 0.8, edge: 6 } as const
export const START_SCREEN = { width: 14, height: 6, depth: 0.5, bottom: 3, edge: 12, leg: 0.4 } as const

/** Nothing stands within this distance of any road at a similar height, beyond that road's half width: behind its rail. */
export const CLEAR_EDGE = FLAG_EDGE - 0.5
/** Roads more than this far below do not block a prop. */
const LEVEL = 4
/**
 * A road above blocks a prop unless its deck's underside (DECK_DEPTH under the road) clears the prop's
 * top by this much: crossover's 9 m start screen stood under its 8 m crossing and pierced the road.
 */
export const DECK_AIR = 1
/** Props stand on the ground: none beside road running higher than this (decks, ramp tops). */
export const GROUND_LEVEL = 1

export type DressingKind = 'flag' | 'totem' | 'startScreen'
/** Each prop's height above the ground: pole, totem, the screen's top edge. */
export const DRESSING_TOP: Record<DressingKind, number> = { flag: POLE.height, totem: TOTEM.height, startScreen: START_SCREEN.bottom + START_SCREEN.height }
/** A prop standing on the ground at (x, z), its face looking toward `heading` (0 = +z). */
export type DressingProp = { kind: DressingKind; x: number; z: number; heading: number }

/** Every run of consecutive `straight` segments at ground level, as [first, last] segment index. */
export const straightRuns = (track: Track): [number, number][] => {
  const ps = poses(track)
  const runs: [number, number][] = []
  let from = -1
  track.segments.forEach((seg, i) => {
    const level = seg.type === 'straight' && ps[i].y < GROUND_LEVEL && Math.abs(ps[i].y) < GROUND_LEVEL
    if (level && from < 0) from = i
    if (!level && from >= 0) runs.push([from, i - 1]), (from = -1)
  })
  if (from >= 0) runs.push([from, track.segments.length - 1])
  return runs.filter(([a, b]) => track.segments.slice(a, b + 1).reduce((sum, seg) => sum + segmentLength(seg), 0) >= FLAG_RUN)
}

/** A point `side` metres to the left (+) or right (-) of a pose, on the ground. */
const beside = (p: { x: number; z: number; heading: number }, side: number): [number, number] => [p.x + Math.cos(p.heading) * side, p.z - Math.sin(p.heading) * side]

export const planDressing = (track: Track): DressingProp[] => {
  const line = centreline(track, 1)
  const clear = (x: number, z: number, reach: number, top: number) =>
    line.every((c) => c.y < -LEVEL || c.y - DECK_DEPTH >= top + DECK_AIR || (c.x - x) ** 2 + (c.z - z) ** 2 >= (c.width / 2 + CLEAR_EDGE + reach) ** 2)
  const ps = poses(track)
  const props: DressingProp[] = []
  // Flags: both sides of every long straight, one pole every FLAG_STEP metres, cloth toward the road.
  for (const [a, b] of straightRuns(track)) {
    for (let i = a; i <= b; i++) {
      const seg = track.segments[i]
      const len = segmentLength(seg)
      for (let s = FLAG_STEP / 2; s < len; s += FLAG_STEP) {
        const p = sampleSegment(ps[i], seg, s / len)
        const half = widthAt(seg, s / len) / 2
        for (const side of [1, -1]) {
          const [x, z] = beside(p, side * (half + FLAG_EDGE))
          if (clear(x, z, 0, DRESSING_TOP.flag)) props.push({ kind: 'flag', x, z, heading: p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2) })
        }
      }
    }
  }
  // Start: walk forward from the start pose along the lap's centreline; totems 20 m and 40 m on, one
  // each side, facing the approaching car; the screen 30 m on, beside the road, facing it. A spot
  // blocked by other road (or a deck overhead) or by a prop already placed tries the other side, then
  // slides along the lap by START_SLIDE, else it is left out.
  // The centreline is sampled every metre from the start, so index d is d metres on.
  const at = (d: number) => line[Math.min(d, line.length - 1)]
  const place = (kind: DressingKind, d: number, edge: number, side: number, reach: number, face: (h: number, side: number) => number) => {
    for (const slide of START_SLIDE) {
      if (d + slide < 0) continue
      const p = at(d + slide)
      if (Math.abs(p.y) >= GROUND_LEVEL) continue
      for (const s of [side, -side]) {
        const [x, z] = beside(p, s * (p.width / 2 + edge))
        const prop = { kind, x, z, heading: face(p.heading, s) }
        if (!clear(x, z, reach, DRESSING_TOP[kind])) continue
        if (props.some((q) => footprintsOverlap(dressingFootprint(q), dressingFootprint(prop)))) continue
        return void props.push(prop)
      }
    }
  }
  place('totem', 20, TOTEM.edge, 1, TOTEM.width / 2, (h) => h + Math.PI)
  place('totem', 40, TOTEM.edge, -1, TOTEM.width / 2, (h) => h + Math.PI)
  place('startScreen', 30, START_SCREEN.edge, 1, START_SCREEN.width / 2, (h, s) => h + (s > 0 ? -Math.PI / 2 : Math.PI / 2))
  return props
}

/** Atlas: the totem face, the start screen face, then a strip of frame colour, top to bottom. */
const ROWS = 3
const FACE = { w: 512, h: 256 }
const FRAME = '#1c1f24'
const rowV = (r: number, v: number) => 1 - (r + 1) / ROWS + v / ROWS
const FRAME_UV: [number, number] = [0.5, rowV(2, 0.5)]
/** BoxGeometry faces are +x, -x, +y, -y, +z, -z, six vertices each once non-indexed: +z is the front. */
const FRONT = [24, 30]

const drawAtlas = (accent: string): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas')
  canvas.width = FACE.w
  canvas.height = FACE.h * ROWS
  const g = canvas.getContext('2d')!
  // Totem: accent panel, the wordmark turned to read bottom to top.
  g.fillStyle = accent
  g.fillRect(0, 0, FACE.w, FACE.h)
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  for (let x = 0; x < FACE.w; x += 64) g.fillRect(x, 0, 24, FACE.h)
  g.save()
  g.translate(FACE.w / 2, FACE.h / 2)
  g.fillStyle = '#ffffff'
  g.font = 'italic 900 120px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('DRIFTLINE', 0, 0)
  g.restore()
  // Start screen: dark board, the wordmark over an accent bar.
  g.fillStyle = '#0d1117'
  g.fillRect(0, FACE.h, FACE.w, FACE.h)
  g.fillStyle = accent
  g.fillRect(48, FACE.h + 176, FACE.w - 96, 18)
  g.fillStyle = '#ffffff'
  g.font = 'italic 900 96px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('DRIFTLINE', FACE.w / 2, FACE.h + 110)
  g.fillStyle = FRAME
  g.fillRect(0, 2 * FACE.h, FACE.w, FACE.h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = anisotropy()
  return tex
}

/** Flag cloth colours: the venue accent, white and the stand colour, in turn along each row. */
const clothColours = (accent: string, stand: string) => [accent, '#ffffff', stand].map((c) => new THREE.Color(c))

/** The dressing: poles, totems and the start screen in one textured mesh, flag cloth in a second. */
export const createDressing = (track: Track, accent = '#ffd21f', stand = '#e13838'): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'dressing'
  const props = planDressing(track)
  if (props.length === 0) return group
  const white = new THREE.Color(1, 1, 1)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const solid: THREE.BufferGeometry[] = []
  const cloth: THREE.BufferGeometry[] = []
  const sheet = new THREE.PlaneGeometry(CLOTH.width, CLOTH.height)
  const colours = clothColours(accent, stand)
  const frame = () => FRAME_UV
  const face = (row: number) => (u: number, v: number, i: number): [number, number] => (i >= FRONT[0] && i < FRONT[1] ? [u, rowV(row, v)] : FRAME_UV)
  props.forEach((p, k) => {
    // Local +z is the face, local +x the reader's right (placement turns by heading about +y).
    const local = (x: number, y: number, z: number, size: [number, number, number]) =>
      new THREE.Matrix4().multiplyMatrices(placement(p.x, 0, p.z, p.heading), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(...size)))
    if (p.kind === 'flag') {
      solid.push(prepared(box, white, local(0, POLE.height / 2, 0, [POLE.size, POLE.height, POLE.size]), frame))
      // The cloth hangs from the pole top on the pole's right, touching it, so it never floats.
      const at = local(POLE.size / 2 + CLOTH.width / 2, POLE.height - CLOTH.height / 2 - 0.1, 0, [1, 1, 1])
      cloth.push(prepared(sheet, colours[k % colours.length], at))
    } else if (p.kind === 'totem') {
      solid.push(prepared(box, white, local(0, TOTEM.height / 2, 0, [TOTEM.width, TOTEM.height, TOTEM.depth]), face(0)))
    } else {
      const S = START_SCREEN
      solid.push(prepared(box, white, local(0, S.bottom + S.height / 2, 0, [S.width, S.height, S.depth]), face(1)))
      for (const x of [-S.width / 3, S.width / 3]) solid.push(prepared(box, white, local(x, (S.bottom + S.height / 2) / 2, -S.depth / 2 - S.leg / 2, [S.leg, S.bottom + S.height / 2, S.leg]), frame))
    }
  })
  const atlas = drawAtlas(accent)
  // A little self-lit, like the sign boards, so faces in shadow still read.
  group.add(noCollide(structural(merged(solid, new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.7 })), 'sign'), 'trackside'))
  if (cloth.length > 0) group.add(flat(merged(cloth, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })), 'screen-face'))
  return group
}
