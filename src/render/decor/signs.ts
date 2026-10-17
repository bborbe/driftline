// Roadside sign boards: chevron boards along the outside of every turn (pointing the way it bends)
// and turbo boards beside every turbo pad. Placement is a pure planner (unit-tested); createSigns()
// bakes every board into one mesh over a canvas texture atlas. Visual only: physics never sees them.
import * as THREE from 'three/webgpu'
import { centreline } from '../../track/centreline'
import { poses, turnSign, zoneCorners, type Track } from '../../track/schema'
import { SIGN_BLACK, SIGN_YELLOW } from '../look'
import { noCollide, structural } from '../tags'
import { lateralPoint, sampleSegment, segmentLength, TRACK_WIDTH } from '../track/geometry'
import { merged, placement, prepared } from './instance'

export type SignKind = 'left' | 'right' | 'turbo' | 'turbo-red'
/** A board standing at (x, y, z), its printed face looking toward `heading` (0 = +z). */
export type Sign = { kind: SignKind; x: number; y: number; z: number; heading: number }

/** Boards stand this far from the centreline: past the grass shoulder, clear of the curb. */
export const SIGN_OFFSET = TRACK_WIDTH / 2 + 1.5
/** No board within this distance of any road at a similar height (hairpins, crossings). */
export const SIGN_CLEARANCE = TRACK_WIDTH / 2 + 1
/** One chevron board per this many metres of turn, at most MAX_TURN_SIGNS per turn. */
export const TURN_SIGN_SPACING = 12
const MAX_TURN_SIGNS = 4
/** Roads more than this far above or below a board do not block it. */
const LEVEL = 4
/**
 * Boards stand on the ground beside the road: none where the road runs higher than this (decks,
 * ramp tops), where a board past the edge would hang over the void on stilts. Deck edges belong to
 * the deck's own walls.
 */
export const GROUND_LEVEL = 1

export const planSigns = (track: Track): Sign[] => {
  const line = centreline(track, 1)
  const clear = (s: Sign) =>
    line.every((c) => Math.abs(c.y - s.y) > LEVEL || (c.x - s.x) ** 2 + (c.z - s.z) ** 2 >= SIGN_CLEARANCE ** 2)
  const signs: Sign[] = []
  const ps = poses(track)
  track.segments.forEach((seg, i) => {
    if (seg.type !== 'curve' && seg.type !== 'hairpin' && seg.type !== 'banked') return
    const s = turnSign(seg)
    const count = Math.min(MAX_TURN_SIGNS, Math.max(1, Math.round(segmentLength(seg) / TURN_SIGN_SPACING)))
    for (let k = 0; k < count; k++) {
      const p = sampleSegment(ps[i], seg, k / count)
      if (p.y >= GROUND_LEVEL) continue
      // The outside of the turn is away from its centre (u = +s·r): u = -s·offset. Stand at the
      // road edge's height, so a board on a banked turn's raised side is not buried.
      const [x, , z] = lateralPoint(p, -s * SIGN_OFFSET, s)
      const y = lateralPoint(p, -s * (TRACK_WIDTH / 2), s)[1]
      signs.push({ kind: s > 0 ? 'left' : 'right', x, y, z, heading: p.heading + Math.PI })
    }
  })
  for (const zone of track.zones ?? []) {
    if (zone.kind !== 'turbo' && zone.kind !== 'turbo-red') continue
    const [left, right] = zoneCorners(track, zone, 2 * SIGN_OFFSET)
    if (left.y >= GROUND_LEVEL) continue
    for (const c of [left, right]) signs.push({ kind: zone.kind, x: c.x, y: c.y, z: c.z, heading: c.heading + Math.PI })
  }
  return signs.filter(clear)
}

/** Board size and the height of its lower edge over the road edge, in metres. Board and posts stay above MIN_THICKNESS (render/lint.ts). */
export const BOARD = { width: 2.6, height: 1.3, depth: 0.16, bottom: 0.6 } as const
const POST = { size: 0.16, spread: 0.9 }

const KINDS: readonly SignKind[] = ['left', 'right', 'turbo', 'turbo-red']
/** Atlas: one 256×128 face per kind, top to bottom, then a strip of frame colour (posts, edges). */
const FACE = { w: 256, h: 128 }
const ROWS = KINDS.length + 1
const FRAME = '#1c1c1c'

/** Printed face: three chevrons (`<` for left, `>` for right, two `^` for turbo) on a contrasting board. */
const drawFace = (g: CanvasRenderingContext2D, kind: SignKind, accent: string) => {
  const { w, h } = FACE
  const turbo = kind === 'turbo' || kind === 'turbo-red'
  const bg = kind === 'turbo-red' ? '#e0241b' : turbo ? SIGN_YELLOW : SIGN_BLACK
  const fg = turbo ? SIGN_BLACK : accent
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.strokeStyle = fg
  g.lineWidth = 6
  g.strokeRect(5, 5, w - 10, h - 10)
  g.fillStyle = fg
  const chevron = (cx: number, cy: number, dir: 'left' | 'right' | 'up') => {
    const a = 26 // half-size
    const t = 16 // stroke thickness
    g.save()
    g.translate(cx, cy)
    g.rotate(dir === 'left' ? 0 : dir === 'right' ? Math.PI : Math.PI / 2)
    // A `<` pointing toward -x.
    g.beginPath()
    g.moveTo(-a, 0)
    g.lineTo(a - t, -a)
    g.lineTo(a, -a)
    g.lineTo(-a + t, 0)
    g.lineTo(a, a)
    g.lineTo(a - t, a)
    g.closePath()
    g.fill()
    g.restore()
  }
  if (turbo) for (const cy of [h / 2 - 22, h / 2 + 18]) chevron(w / 2, cy, 'up')
  else for (const cx of [w / 2 - 64, w / 2, w / 2 + 64]) chevron(cx, h / 2, kind === 'left' ? 'left' : 'right')
}

const atlasTexture = (accent: string): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas')
  canvas.width = FACE.w
  canvas.height = FACE.h * ROWS
  const g = canvas.getContext('2d')!
  KINDS.forEach((kind, r) => {
    g.save()
    g.translate(0, r * FACE.h)
    drawFace(g, kind, accent)
    g.restore()
  })
  g.fillStyle = FRAME
  g.fillRect(0, KINDS.length * FACE.h, FACE.w, FACE.h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Canvas row r (from the top) in uv space: flipY puts the canvas top at v = 1. */
const rowV = (r: number, v: number) => 1 - (r + 1) / ROWS + v / ROWS
const FRAME_UV: [number, number] = [0.5, rowV(KINDS.length, 0.5)]
/** BoxGeometry faces are +x, -x, +y, -y, +z, -z, six vertices each once non-indexed: +z is the front. */
const FRONT = [24, 30]

/** Turn boards print `accent` chevrons (a theme's `sign`); turbo boards keep their gameplay colours. */
export const createSigns = (track: Track, accent: string = SIGN_YELLOW): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'signs'
  const white = new THREE.Color(1, 1, 1)
  const board = new THREE.BoxGeometry(BOARD.width, BOARD.height, BOARD.depth)
  const post = new THREE.BoxGeometry(1, 1, 1)
  const parts: THREE.BufferGeometry[] = []
  for (const s of planSigns(track)) {
    // rotation.y = heading turns local +z (the printed face) to `heading` and local +x to the reader's
    // right, so the canvas reads left to right.
    const row = KINDS.indexOf(s.kind)
    const uv = (u: number, v: number, i: number): [number, number] => (i >= FRONT[0] && i < FRONT[1] ? [u, rowV(row, v)] : FRAME_UV)
    parts.push(prepared(board, white, placement(s.x, s.y + BOARD.bottom + BOARD.height / 2, s.z, s.heading), uv))
    // Two posts from the ground (y 0) to the board's top edge, just behind it (local -z) so they
    // never poke through the printed face.
    const top = s.y + BOARD.bottom + BOARD.height
    const back = BOARD.depth / 2 + POST.size / 2
    for (const side of [-1, 1]) {
      const x = s.x + Math.cos(s.heading) * side * POST.spread - Math.sin(s.heading) * back
      const z = s.z - Math.sin(s.heading) * side * POST.spread - Math.cos(s.heading) * back
      parts.push(prepared(post, white, placement(x, top / 2, z, s.heading, [POST.size, top, POST.size]), () => FRAME_UV))
    }
  }
  // One draw call for every board. A little self-lit so boards in shadow still read.
  const atlas = atlasTexture(accent)
  group.add(noCollide(structural(merged(parts, new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8 })), 'sign'), 'roadside-sign'))
  return group
}
