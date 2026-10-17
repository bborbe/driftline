// Structural validation of untrusted track JSON.
import { ZONE_KINDS, zoneSegments, type Medals, type Pose, type Segment, type Track } from './schema'
import { validateTheme } from './theme'

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
      else if ((t.segments as Segment[])[g.segment]?.type === 'gap') errs.push(`gates[${i}]: a gate cannot stand on a gap (no road)`)
      if (g?.at !== undefined && !(typeof g.at === 'number' && g.at >= 0 && g.at < 1)) errs.push(`gates[${i}]: at must be in [0, 1)`)
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
        else if (ZONE_KINDS.includes(z?.kind) && !zoneSegments(z.kind).includes(seg.type)) {
          errs.push(`zones[${i}]: ${z.kind} zones lie on ${zoneSegments(z.kind).join('|')} only`)
        }
        if (!(Number.isFinite(z?.from) && Number.isFinite(z?.to) && z.from >= 0 && z.from < z.to && z.to <= 1)) {
          errs.push(`zones[${i}]: needs 0 <= from < to <= 1`)
        }
        if (z?.reverse !== undefined && typeof z.reverse !== 'boolean') errs.push(`zones[${i}]: reverse must be a boolean`)
      })
    }
  }
  if (t.barriers !== undefined) {
    const point = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    if (!Array.isArray(t.barriers)) {
      errs.push('barriers must be an array')
    } else {
      const n = Array.isArray(t.segments) ? t.segments.length : 0
      const fraction = (v: unknown) => v === undefined || (Number.isFinite(v) && (v as number) >= 0 && (v as number) <= 1)
      t.barriers.forEach((b, i) => {
        if (b && 'segment' in b) {
          if (!Number.isInteger(b.segment) || b.segment < 0 || b.segment >= n) errs.push(`barriers[${i}]: segment out of range`)
          if (b.side !== 'left' && b.side !== 'right') errs.push(`barriers[${i}]: side must be left or right`)
          if (b.gap !== undefined && !(Number.isFinite(b.gap) && b.gap >= 0)) errs.push(`barriers[${i}]: gap must be >= 0`)
          if (!fraction(b.from) || !fraction(b.to) || (b.from ?? 0) >= (b.to ?? 1)) errs.push(`barriers[${i}]: needs 0 <= from < to <= 1`)
        } else if (!point(b?.from) || !point(b?.to)) errs.push(`barriers[${i}]: needs from and to as [x, z]`)
        else if (b.from[0] === b.to[0] && b.from[1] === b.to[1]) errs.push(`barriers[${i}]: from and to must differ`)
      })
    }
  }
  if (t.theme !== undefined) errs.push(...validateTheme(t.theme))
  return errs
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
    case 'loop':
      return turnOk && pos(o.radius) && (o.shift === undefined || pos(o.shift)) ? null : 'needs turn, radius > 0, shift > 0 when given'
    case 'wallride':
      return turnOk && pos(o.radius) && (o.angle === 90 || o.angle === 180) ? null : 'needs turn, radius > 0, angle 90|180'
    case 'banked':
      return turnOk && pos(o.radius) && (o.angle === 90 || o.angle === 180) && Number.isFinite(o.bank)
        ? null
        : 'needs turn, radius > 0, angle 90|180, bank (radians)'
    default:
      return `unknown segment type ${String(o.type)}`
  }
}
