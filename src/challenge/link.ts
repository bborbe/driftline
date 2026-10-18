// Challenge links: a URL that carries a target time and, when it fits, the sender's best-lap ghost — no server.
// The ghost travels lossless: the replay re-simulates the deterministic physics, so a rounded input would put the
// ghost on another line. Inputs are run-length coded, so a keyboard lap (discrete inputs) is a few hundred runs; an
// encoding over MAX_CHALLENGE_CHARS drops the ghost and keeps the target. Discrete inputs (keyboard: throttle and
// brake 0|1, steer -1|0|1, at most one slow-motion scale) pack to one letter per input state with a decimal run count
// in front (`12Ab3C`); any other input falls back to numeric runs, which only a short lap fits. Pure and tested.
import type { CarInput, CarState } from '../physics'
import type { GhostRun } from '../ghost/ghost'

export const CHALLENGE_VERSION = 1
/** Longest `challenge` value a link carries with its ghost; over it the link keeps the target time only. */
export const MAX_CHALLENGE_CHARS = 8192
/** Longest ghost a link may decode to (10 min at 100 Hz): a forged run count cannot allocate without bound. */
export const MAX_GHOST_TICKS = 60_000
/** Longest sender name (the leaderboard's). */
export const MAX_NAME = 12

export interface Challenge {
  track: string
  /** layoutId of the track the run was driven on: a changed layout makes the link stale. */
  layout: string
  laps: number
  targetMs: number
  /** Sender's name, upper case; empty when they set none. */
  name: string
  /** The sender's best lap, or null (target-only link: too large, multi-lap, or no session lap). */
  ghost: GhostRun | null
}

export type ChallengeRead = { ok: true; challenge: Challenge } | { ok: false; reason: string }

/** What the opening page knows: the `?track=` it loads, its lap count and each track's current layoutId. */
export interface ChallengeContext {
  track: string | null
  laps: number
  /** layoutId of a track by name, null when no such track exists. */
  layoutOf: (track: string) => string | null
}

export const cleanName = (name: string): string => name.trim().toUpperCase().slice(0, MAX_NAME)

// -0 and +0 differ to the physics (atan2, division), and JSON writes both as 0: keep -0 as a string.
const NEG_ZERO = '-0'
const num = (v: number): number | string => (Object.is(v, -0) ? NEG_ZERO : v)
const unnum = (v: unknown): number => (v === NEG_ZERO ? -0 : (v as number))

const stateArray = (s: CarState): number[] => [
  s.position.x, s.position.y, s.position.z,
  s.velocity.x, s.velocity.y, s.velocity.z,
  s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w,
  s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z,
  s.steerAngle, s.tick, s.turbo, s.turboForce,
]
const STATE_LEN = 17

const stateFrom = (a: number[]): CarState => ({
  position: { x: a[0], y: a[1], z: a[2] },
  velocity: { x: a[3], y: a[4], z: a[5] },
  orientation: { x: a[6], y: a[7], z: a[8], w: a[9] },
  angularVelocity: { x: a[10], y: a[11], z: a[12] },
  steerAngle: a[13],
  tick: a[14],
  turbo: a[15],
  turboForce: a[16],
})

// One run per stretch of identical inputs: [count, throttle, brake, steer, handbrake 0|1, timeScale (0 = none)].
const RUN_LEN = 6
const sameInput = (a: CarInput, b: CarInput): boolean =>
  Object.is(a.throttle, b.throttle) && Object.is(a.brake, b.brake) && Object.is(a.steer, b.steer) && a.handbrake === b.handbrake && a.timeScale === b.timeScale

export function inputRuns(inputs: readonly CarInput[]): number[] {
  const out: number[] = []
  for (let i = 0; i < inputs.length; ) {
    let j = i + 1
    while (j < inputs.length && sameInput(inputs[i], inputs[j])) j++
    const x = inputs[i]
    out.push(j - i, x.throttle, x.brake, x.steer, x.handbrake ? 1 : 0, x.timeScale ?? 0)
    i = j
  }
  return out
}

export function inputsFromRuns(runs: readonly number[]): CarInput[] {
  const out: CarInput[] = []
  for (let i = 0; i < runs.length; i += RUN_LEN) {
    const [count, throttle, brake, steer, handbrake, timeScale] = runs.slice(i, i + RUN_LEN)
    const input: CarInput = { throttle, brake, steer, handbrake: handbrake === 1 }
    if (timeScale !== 0) input.timeScale = timeScale
    for (let k = 0; k < count; k++) out.push({ ...input })
  }
  return out
}

// Discrete-input packing: symbol = ((((throttle·2 + brake)·3 + steer+1)·2 + handbrake)·2 + scaled), 48 letters.
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv'
const bit = (v: number): number | null => (Object.is(v, 0) ? 0 : v === 1 ? 1 : null)
const trit = (v: number): number | null => (Object.is(v, 0) ? 1 : v === 1 ? 2 : v === -1 ? 0 : null)

/** The packed form of `inputs` and its one slow-motion scale, or null when an input is not discrete. */
export function packInputs(inputs: readonly CarInput[]): { keys: string; scale?: number } | null {
  const scales = new Set(inputs.map((i) => i.timeScale).filter((v) => v !== undefined))
  if (scales.size > 1) return null
  const scale = [...scales][0]
  let keys = ''
  for (let i = 0; i < inputs.length; ) {
    let j = i + 1
    while (j < inputs.length && sameInput(inputs[i], inputs[j])) j++
    const x = inputs[i]
    const t = bit(x.throttle)
    const b = bit(x.brake)
    const st = trit(x.steer)
    if (t === null || b === null || st === null) return null
    keys += `${j - i > 1 ? j - i : ''}${SYMBOLS[(((t * 2 + b) * 3 + st) * 2 + (x.handbrake ? 1 : 0)) * 2 + (x.timeScale === undefined ? 0 : 1)]}`
    i = j
  }
  return scale === undefined ? { keys } : { keys, scale }
}

/** Inputs from packInputs' form; null when `keys` is not a valid packing or decodes past `maxTicks`. */
export function unpackInputs(keys: string, scale: number | undefined, maxTicks: number): CarInput[] | null {
  const out: CarInput[] = []
  const re = /(\d*)([A-Za-v])/y
  let m: RegExpExecArray | null
  while (re.lastIndex < keys.length && (m = re.exec(keys))) {
    const count = m[1] === '' ? 1 : Number(m[1])
    if (count < 1 || out.length + count > maxTicks) return null
    let sym = SYMBOLS.indexOf(m[2])
    const scaled = sym % 2
    sym = (sym - scaled) / 2
    const handbrake = sym % 2 === 1
    sym = (sym - (sym % 2)) / 2
    const steer = (sym % 3) - 1
    sym = (sym - (sym % 3)) / 3
    if (scaled === 1 && scale === undefined) return null
    const input: CarInput = { throttle: sym >> 1, brake: sym & 1, steer, handbrake }
    if (scaled === 1) input.timeScale = scale
    for (let k = 0; k < count; k++) out.push({ ...input })
  }
  return re.lastIndex === keys.length || keys.length === 0 ? out : null
}

const toBase64Url = (text: string): string => {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (s: string): string => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

const pack = (c: Challenge, ghost: GhostRun | null): string =>
  toBase64Url(
    JSON.stringify({
      v: CHALLENGE_VERSION,
      t: c.track,
      l: c.layout,
      n: c.laps,
      ms: c.targetMs,
      nm: cleanName(c.name),
      ...(ghost ? { g: { s: stateArray(ghost.start).map(num), ...(packInputs(ghost.inputs) ?? { r: inputRuns(ghost.inputs).map(num) }), ms: ghost.lapTimeMs } } : {}),
    }),
  )

/** The `challenge` value: with the ghost when it fits in MAX_CHALLENGE_CHARS (and every number is finite), else target only. */
export function encodeChallenge(c: Challenge): string {
  const finite = c.ghost !== null && stateArray(c.ghost.start).every(Number.isFinite) && inputRuns(c.ghost.inputs).every(Number.isFinite)
  if (finite) {
    const full = pack(c, c.ghost)
    if (full.length <= MAX_CHALLENGE_CHARS) return full
  }
  return pack(c, null)
}

/** The shareable URL: base + `?track=&laps=&challenge=`; the opening page's settings stay its own. */
export function challengeUrl(base: string, c: Challenge): string {
  const q = new URLSearchParams({ track: c.track, laps: String(c.laps), challenge: encodeChallenge(c) })
  return `${base}?${q.toString()}`
}

const DAMAGED = 'the link is damaged'
const isNum = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || v === NEG_ZERO

/** Reads a `challenge` value against the page it opens on; every failure names its reason (shown to the player). */
export function readChallenge(value: string, ctx: ChallengeContext): ChallengeRead {
  let raw: unknown
  try {
    raw = JSON.parse(fromBase64Url(value))
  } catch {
    return { ok: false, reason: DAMAGED }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: DAMAGED }
  const p = raw as Record<string, unknown>
  if (p.v !== CHALLENGE_VERSION) return { ok: false, reason: 'it was made by a different game version' }
  if (typeof p.t !== 'string' || typeof p.l !== 'string' || typeof p.nm !== 'string' || !Number.isInteger(p.n) || !isNum(p.ms) || (p.ms as number) <= 0) {
    return { ok: false, reason: DAMAGED }
  }
  const layout = ctx.layoutOf(p.t)
  if (layout === null) return { ok: false, reason: `unknown track "${p.t}"` }
  if (ctx.track !== p.t) return { ok: false, reason: `it is for ${p.t}, not ${ctx.track ?? 'the menu'}` }
  if (layout !== p.l) return { ok: false, reason: `${p.t} has changed since the link was made` }
  if (p.n !== ctx.laps) return { ok: false, reason: `it is a ${p.n}-lap challenge, this race has ${ctx.laps}` }
  let ghost: GhostRun | null = null
  if (p.g !== undefined) {
    const g = p.g as Record<string, unknown> | null
    const s = g?.s
    if (!g || !Array.isArray(s) || s.length !== STATE_LEN || !s.every(isNum) || !isNum(g.ms)) return { ok: false, reason: DAMAGED }
    const inputs = typeof g.keys === 'string' ? keyInputs(g.keys, g.scale) : numericInputs(g.r)
    if (!inputs) return { ok: false, reason: DAMAGED }
    ghost = { start: stateFrom(s.map(unnum)), inputs, lapTimeMs: unnum(g.ms) }
  }
  return { ok: true, challenge: { track: p.t, layout: p.l, laps: p.n as number, targetMs: unnum(p.ms), name: p.nm, ghost } }
}

const keyInputs = (keys: string, scale: unknown): CarInput[] | null =>
  scale !== undefined && !(typeof scale === 'number' && Number.isFinite(scale)) ? null : unpackInputs(keys, scale as number | undefined, MAX_GHOST_TICKS)

function numericInputs(r: unknown): CarInput[] | null {
  if (!Array.isArray(r) || r.length % RUN_LEN !== 0 || !r.every(isNum)) return null
  const runs = r.map(unnum)
  const counts = runs.filter((_, i) => i % RUN_LEN === 0)
  if (counts.some((v) => !Number.isInteger(v) || v < 1) || counts.reduce((a, b) => a + b, 0) > MAX_GHOST_TICKS) return null
  return inputsFromRuns(runs)
}
