// Shared track format. Consumed by render (src/render/), physics (src/physics/)
// and the lap loop (src/race/). Pure TypeScript: no three, no browser APIs, so
// physics may import it.

/** Grid cell size in metres. Every piece's footprint is a multiple of it. */
export const CELL = 10

/** World pose at a piece connection edge: bottom-center, heading in radians (0 = +z, CCW positive). */
export interface Pose {
  x: number
  y: number
  z: number
  heading: number
}

export type Turn = 'left' | 'right'

export type Segment =
  | { type: 'straight'; length: number }
  | { type: 'curve'; turn: Turn; radius: number; angle: 90 | 45 }
  | { type: 'hairpin'; turn: Turn; radius: number }
  | { type: 'ramp'; length: number; rise: number }
  | { type: 'drop'; length: number; fall: number }
  | { type: 'banked'; turn: Turn; radius: number; angle: 90 | 180; bank: number }
  /** No road: a jump across `length` metres of air, landing `fall` metres lower (default 0). */
  | { type: 'gap'; length: number; fall?: number }

export type SegmentType = Segment['type']

export const SEGMENT_TYPES: readonly SegmentType[] = ['straight', 'curve', 'hairpin', 'ramp', 'drop', 'banked', 'gap']

export type GateKind = 'start-finish' | 'checkpoint'

/** A gate sits on the entry edge of segment `segment` (index into Track.segments). */
export interface Gate {
  kind: GateKind
  segment: number
}

/** Medal target lap times in ms; author is the fastest. */
export interface Medals {
  author: number
  gold: number
  silver: number
  bronze: number
}

/** Special patches of road: turbo pads (yellow = short boost, red = strong) and low-grip surfaces. */
export type ZoneKind = 'turbo' | 'turbo-red' | 'dirt' | 'ice' | 'grass'

export const ZONE_KINDS: readonly ZoneKind[] = ['turbo', 'turbo-red', 'dirt', 'ice', 'grass']

/** Segment types a zone may lie on: planar strips, so the patch is a flat quad on the road. */
export const ZONE_SEGMENTS: readonly SegmentType[] = ['straight', 'ramp', 'drop']

/** A full-width patch on segment `segment`, from fraction `from` to `to` (0..1) of its length. */
export interface Zone {
  kind: ZoneKind
  segment: number
  from: number
  to: number
}

/** A straight wall on the open ground, world x/z from `from` to `to`: blocks a shortcut across the grass. */
export interface Barrier {
  from: [number, number]
  to: [number, number]
}

/** Barrier cross-section in metres: a low red-and-white plastic wall, Trackmania-style. */
export const BARRIER = { halfWidth: 0.5, height: 1.2 } as const

export interface Track {
  name: string
  start: Pose
  segments: Segment[]
  gates: Gate[]
  /** Optional: not part of layoutId, so retuning medals keeps existing records. */
  medals?: Medals
  zones?: Zone[]
  barriers?: Barrier[]
}

/** Exit pose of one segment given its entry pose. */
export function exitPose(entry: Pose, seg: Segment): Pose {
  switch (seg.type) {
    case 'straight':
      return advance(entry, seg.length, 0)
    case 'ramp':
      return advance(entry, seg.length, seg.rise)
    case 'drop':
      return advance(entry, seg.length, -seg.fall)
    case 'gap':
      return advance(entry, seg.length, -(seg.fall ?? 0))
    case 'curve':
      return arc(entry, seg.turn, seg.radius, (seg.angle * Math.PI) / 180)
    case 'hairpin':
      return arc(entry, seg.turn, seg.radius, Math.PI)
    case 'banked':
      return arc(entry, seg.turn, seg.radius, (seg.angle * Math.PI) / 180)
  }
}

/** Native length of a straight road tile (assets/track/pieces.json); straights are split into tiles of about this length. */
export const TILE_LENGTH = 20

/** Length of each tile a straight of `length` is split into (whole tiles, stretched to fit). */
export const tileLength = (length: number): number => length / Math.max(1, Math.round(length / TILE_LENGTH))

/**
 * The start/finish arch stands this fraction of the way along its start tile: the Kenney
 * roadStart banner sits mid-tile (pinned by src/track/assets.test.ts against the model).
 */
export const START_ARCH_FRACTION = 0.5

/**
 * Where a gate's line actually is — the single source for the lap trigger (src/race) and
 * the arch (src/render). Checkpoints sit on their segment's entry edge; a start/finish gate
 * on a straight sits under the start tile's arch.
 */
export function gateLine(track: Track, gate: Gate): Pose {
  const entry = poses(track)[gate.segment]
  const seg = track.segments[gate.segment]
  if (gate.kind !== 'start-finish' || seg.type !== 'straight') return entry
  return exitPose(entry, { type: 'straight', length: tileLength(seg.length) * START_ARCH_FRACTION })
}

/**
 * Gate pillar footprint, measured from the Kenney start/checkpoint models (assets/pieces):
 * each pillar spans 5.17–6.30 m either side of the centreline and 1.9 m along the track.
 */
export const GATE_PILLAR = { offset: 5.735, halfWidth: 0.565, halfDepth: 0.95, height: 6.7 } as const

/** A solid gate pillar: an upright box centred on (x, z), standing on y, rotated by heading. */
export interface Pillar extends Pose {
  halfWidth: number
  halfDepth: number
  height: number
}

/**
 * Both pillars of a gate — the single source for the pillar colliders (src/physics) and the
 * procedural arch (src/render). A start/finish arch stands on its gate line; a checkpoint
 * model's pillars start at the segment's entry edge, so they centre halfDepth past it.
 */
export function gatePillars(track: Track, gate: Gate): Pillar[] {
  const line = gateLine(track, gate)
  const along = gate.kind === 'checkpoint' ? GATE_PILLAR.halfDepth : 0
  const fx = Math.sin(line.heading)
  const fz = Math.cos(line.heading)
  return [-1, 1].map((side) => ({
    x: line.x + fx * along + fz * side * GATE_PILLAR.offset,
    y: line.y,
    z: line.z + fz * along - fx * side * GATE_PILLAR.offset,
    heading: line.heading,
    halfWidth: GATE_PILLAR.halfWidth,
    halfDepth: GATE_PILLAR.halfDepth,
    height: GATE_PILLAR.height,
  }))
}

/** Every barrier as an upright box — the single source for the colliders (src/physics) and the walls (src/render). */
export function barrierPillars(track: Track): Pillar[] {
  return (track.barriers ?? []).map(({ from: [x0, z0], to: [x1, z1] }) => ({
    x: (x0 + x1) / 2,
    y: 0,
    z: (z0 + z1) / 2,
    heading: Math.atan2(x1 - x0, z1 - z0),
    halfWidth: BARRIER.halfWidth,
    halfDepth: Math.hypot(x1 - x0, z1 - z0) / 2,
    height: BARRIER.height,
  }))
}

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

/** Entry pose of every segment followed by the final exit pose (length segments + 1). */
export function poses(track: Track): Pose[] {
  const out = [track.start]
  for (const seg of track.segments) out.push(exitPose(out[out.length - 1], seg))
  return out
}

function advance(p: Pose, length: number, dy: number): Pose {
  return {
    x: p.x + Math.sin(p.heading) * length,
    y: p.y + dy,
    z: p.z + Math.cos(p.heading) * length,
    heading: p.heading,
  }
}

function arc(p: Pose, turn: Turn, radius: number, angle: number): Pose {
  const s = turn === 'left' ? 1 : -1
  // Center of the turn circle, perpendicular to heading.
  const cx = p.x + Math.cos(p.heading) * radius * s
  const cz = p.z - Math.sin(p.heading) * radius * s
  const heading = p.heading + s * angle
  return {
    x: cx - Math.cos(heading) * radius * s,
    y: p.y,
    z: cz + Math.sin(heading) * radius * s,
    heading,
  }
}

/** Structural validation of untrusted JSON. Returns a list of problems, empty when valid. */
export function validate(data: unknown): string[] {
  const errs: string[] = []
  const t = data as Partial<Track>
  if (typeof t !== 'object' || t === null) return ['track is not an object']
  if (typeof t.name !== 'string') errs.push('name must be a string')
  if (!isPose(t.start)) errs.push('start must be a pose {x,y,z,heading}')
  if (!Array.isArray(t.segments) || t.segments.length === 0) {
    errs.push('segments must be a non-empty array')
  } else {
    t.segments.forEach((s, i) => {
      const e = segmentError(s)
      if (e) errs.push(`segments[${i}]: ${e}`)
    })
  }
  if (!Array.isArray(t.gates)) {
    errs.push('gates must be an array')
  } else {
    const n = Array.isArray(t.segments) ? t.segments.length : 0
    t.gates.forEach((g, i) => {
      if (g?.kind !== 'start-finish' && g?.kind !== 'checkpoint') errs.push(`gates[${i}]: unknown kind`)
      if (!Number.isInteger(g?.segment) || g.segment < 0 || g.segment >= n) errs.push(`gates[${i}]: segment out of range`)
    })
  }
  if (t.medals !== undefined) {
    const m = t.medals as Partial<Medals>
    const times = [m?.author, m?.gold, m?.silver, m?.bronze]
    if (!times.every(pos)) errs.push('medals must have positive author, gold, silver, bronze times')
    else if (!times.every((v, i) => i === 0 || (v as number) > (times[i - 1] as number))) {
      errs.push('medals must be ordered author < gold < silver < bronze')
    }
  }
  if (t.zones !== undefined) {
    if (!Array.isArray(t.zones)) {
      errs.push('zones must be an array')
    } else {
      const segs = Array.isArray(t.segments) ? t.segments : []
      t.zones.forEach((z, i) => {
        if (!ZONE_KINDS.includes(z?.kind)) errs.push(`zones[${i}]: unknown kind`)
        const seg = Number.isInteger(z?.segment) ? segs[z.segment] : undefined
        if (!seg) errs.push(`zones[${i}]: segment out of range`)
        else if (!ZONE_SEGMENTS.includes(seg.type)) errs.push(`zones[${i}]: zones lie on ${ZONE_SEGMENTS.join('|')} only`)
        if (!(Number.isFinite(z?.from) && Number.isFinite(z?.to) && z.from >= 0 && z.from < z.to && z.to <= 1)) {
          errs.push(`zones[${i}]: needs 0 <= from < to <= 1`)
        }
      })
    }
  }
  if (t.barriers !== undefined) {
    const point = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    if (!Array.isArray(t.barriers)) {
      errs.push('barriers must be an array')
    } else {
      t.barriers.forEach((b, i) => {
        if (!point(b?.from) || !point(b?.to)) errs.push(`barriers[${i}]: needs from and to as [x, z]`)
        else if (b.from[0] === b.to[0] && b.from[1] === b.to[1]) errs.push(`barriers[${i}]: from and to must differ`)
      })
    }
  }
  return errs
}

/** Corners of a zone's quad on the road: [left, right] at `from`, then [left, right] at `to`. */
export function zoneCorners(track: Track, zone: Zone, width: number): Pose[] {
  const entry = poses(track)[zone.segment]
  const seg = track.segments[zone.segment]
  const length = 'length' in seg ? seg.length : 0
  const dy = seg.type === 'ramp' ? seg.rise : seg.type === 'drop' ? -seg.fall : 0
  const fx = Math.sin(entry.heading)
  const fz = Math.cos(entry.heading)
  const out: Pose[] = []
  for (const f of [zone.from, zone.to]) {
    for (const side of [1, -1]) {
      out.push({
        x: entry.x + fx * length * f + fz * side * (width / 2),
        y: entry.y + dy * f,
        z: entry.z + fz * length * f - fx * side * (width / 2),
        heading: entry.heading,
      })
    }
  }
  return out
}

function isPose(p: unknown): p is Pose {
  const o = p as Pose
  return typeof o === 'object' && o !== null && [o.x, o.y, o.z, o.heading].every((v) => Number.isFinite(v))
}

function pos(v: unknown): boolean {
  return Number.isFinite(v) && (v as number) > 0
}

function segmentError(s: unknown): string | null {
  const o = s as Record<string, unknown>
  if (typeof o !== 'object' || o === null) return 'not an object'
  const turnOk = o.turn === 'left' || o.turn === 'right'
  switch (o.type) {
    case 'straight':
      return pos(o.length) ? null : 'length must be > 0'
    case 'ramp':
      return pos(o.length) && pos(o.rise) ? null : 'length and rise must be > 0'
    case 'drop':
      return pos(o.length) && pos(o.fall) ? null : 'length and fall must be > 0'
    case 'gap':
      return pos(o.length) && (o.fall === undefined || (Number.isFinite(o.fall) && (o.fall as number) >= 0))
        ? null
        : 'length must be > 0, fall >= 0 when given'
    case 'curve':
      return turnOk && pos(o.radius) && (o.angle === 90 || o.angle === 45) ? null : 'needs turn, radius > 0, angle 45|90'
    case 'hairpin':
      return turnOk && pos(o.radius) ? null : 'needs turn, radius > 0'
    case 'banked':
      return turnOk && pos(o.radius) && (o.angle === 90 || o.angle === 180) && Number.isFinite(o.bank)
        ? null
        : 'needs turn, radius > 0, angle 90|180, bank (radians)'
    default:
      return `unknown segment type ${String(o.type)}`
  }
}
