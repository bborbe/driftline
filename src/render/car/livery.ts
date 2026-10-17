// Car liveries: a paint colour, a code-drawn pattern and a race number. Pure TypeScript — the
// drawing goes through a minimal 2D-context interface, so tests run without a browser.
// Applying a livery to a car mesh is src/render/car/paint.ts.

export const PATTERNS = ['solid', 'stripes', 'chevrons', 'two-tone', 'checker', 'flag'] as const
export type Pattern = (typeof PATTERNS)[number]

/** Paint presets, all saturated so every one has a hue (the ghost rule needs it). */
export const PAINTS = {
  red: '#d62828',
  orange: '#f77f00',
  yellow: '#f6c026',
  lime: '#7cc22b',
  teal: '#14a39a',
  blue: '#1f5fd6',
  purple: '#7b2cbf',
  pink: '#ff4d8d',
} as const
export type Paint = keyof typeof PAINTS
export const PAINT_IDS = Object.keys(PAINTS) as Paint[]

export interface Livery {
  pattern: Pattern
  paint: Paint
  /** Race number, 1–99. */
  number: number
}

export const DEFAULT_LIVERY: Livery = { pattern: 'stripes', paint: 'orange', number: 7 }
export const MAX_NUMBER = 99

/** A stored or user-entered livery, with every field checked and defaulted. */
export const clampLivery = (raw: unknown): Livery => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pattern = (PATTERNS as readonly unknown[]).includes(r.pattern) ? (r.pattern as Pattern) : DEFAULT_LIVERY.pattern
  const paint = (PAINT_IDS as unknown[]).includes(r.paint) ? (r.paint as Paint) : DEFAULT_LIVERY.paint
  const n = Math.round(Number(r.number))
  const number = Number.isFinite(n) && n >= 1 ? Math.min(MAX_NUMBER, n) : DEFAULT_LIVERY.number
  return { pattern, paint, number }
}

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255]
}

/** Hue in degrees, 0–360. */
export const hue = (hex: string): number => {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** Shortest distance between two hues, 0–180 degrees. */
export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * The ghost's livery: the next pattern after the player's and the paint whose hue is furthest
 * from the player's, so the ghost never reads as the player's own car.
 */
export const ghostLivery = (player: Livery): Livery => {
  const h = hue(PAINTS[player.paint])
  const paint = PAINT_IDS.reduce((best, p) => (hueDistance(hue(PAINTS[p]), h) > hueDistance(hue(PAINTS[best]), h) ? p : best))
  const pattern = PATTERNS[(PATTERNS.indexOf(player.pattern) + 1) % PATTERNS.length]
  return { pattern, paint, number: player.number }
}

/** White trim on dark paint, charcoal on light paint. */
export const trimColour = (paint: string): string => {
  const [r, g, b] = rgb(paint)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? '#1d1f24' : '#f4f4f4'
}

/**
 * The livery texture is an atlas of horizontal bands, one per projection of the car body. In
 * every band image x runs rear → front of the car, except the left band, which is drawn mirrored
 * because its UVs run front → rear (so it is not seen mirrored from the car's left). Band y runs
 * across the car (top, +x at the image top) or bottom → top (sides, ends).
 */
export type Band = 'top' | 'left' | 'right' | 'end'
export const BANDS: readonly Band[] = ['top', 'left', 'right', 'end']
/** Band → [v0, v1] in texture space (v = 0 is the bottom row of the image, as three.js samples it). */
export const bandRange = (band: Band): [number, number] => {
  const i = BANDS.indexOf(band)
  return [1 - (i + 1) / BANDS.length, 1 - i / BANDS.length]
}

/** Where the race number sits: band and centre in band coordinates (x 0 = rear, 1 = front; y 0 = bottom). */
export type NumberPlate = { at: 'nose' | 'left' | 'right'; band: Band; x: number; y: number; radius: number }
export const NUMBER_PLATES: readonly NumberPlate[] = [
  // On the deck ahead of the cockpit: the nose tip of the Kenney cars is too narrow for a legible plate.
  { at: 'nose', band: 'top', x: 0.63, y: 0.5, radius: 0.15 },
  { at: 'left', band: 'left', x: 0.45, y: 0.55, radius: 0.32 },
  { at: 'right', band: 'right', x: 0.45, y: 0.55, radius: 0.32 },
]

/** The subset of CanvasRenderingContext2D the livery drawing uses. */
export interface Draw2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
  fillText(text: string, x: number, y: number): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  rotate(angle: number): void
}

/** Draw `pattern` in a w × h band, x rear → front. */
const drawPattern = (g: Draw2D, pattern: Pattern, paint: string, trim: string, w: number, h: number): void => {
  g.fillStyle = paint
  g.fillRect(0, 0, w, h)
  g.fillStyle = trim
  switch (pattern) {
    case 'solid':
      break
    case 'stripes': // twin racing stripes along the car
      g.fillRect(0, h * 0.28, w, h * 0.14)
      g.fillRect(0, h * 0.58, w, h * 0.14)
      break
    case 'chevrons': // arrows pointing to the nose
      for (let i = 0; i < 4; i++) {
        const x = w * (0.08 + i * 0.22)
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x + w * 0.08, 0)
        g.lineTo(x + w * 0.2, h / 2)
        g.lineTo(x + w * 0.08, h)
        g.lineTo(x, h)
        g.lineTo(x + w * 0.12, h / 2)
        g.closePath()
        g.fill()
      }
      break
    case 'two-tone': // rear half in the trim colour
      g.fillRect(0, 0, w * 0.45, h)
      break
    case 'checker': {
      const cols = 16
      const rows = 4
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if ((c + r) % 2 === 0) g.fillRect((c * w) / cols, (r * h) / rows, w / cols, h / rows)
      break
    }
    case 'flag': // three blocks along the car: trim · paint · dark
      g.fillRect(0, 0, w / 3, h)
      g.fillStyle = '#1d1f24'
      g.fillRect((2 * w) / 3, 0, w / 3, h)
      break
  }
}

const drawNumber = (g: Draw2D, n: number, x: number, y: number, r: number): void => {
  g.fillStyle = '#f4f4f4'
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#111111'
  g.font = `bold ${Math.round(r * (n > 9 ? 1.1 : 1.4))}px sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(n), x, y + r * 0.06)
}

/** Draw the whole atlas, `size` px square: one band per `BANDS` entry, top to bottom. */
export const drawLivery = (g: Draw2D, livery: Livery, size: number): void => {
  const paint = PAINTS[livery.paint]
  const trim = trimColour(paint)
  const h = size / BANDS.length
  BANDS.forEach((band, i) => {
    g.save()
    g.translate(0, i * h)
    if (band === 'left') {
      g.translate(size, 0)
      g.scale(-1, 1)
    }
    drawPattern(g, livery.pattern, paint, trim, size, h)
    for (const p of NUMBER_PLATES) {
      if (p.band !== band) continue
      // Digits read upright from where the plate is seen: undo the left band's mirror, and turn
      // the nose plate a quarter so it reads from the chase cam (image +x is the car's nose there).
      g.save()
      g.translate(p.x * size, (1 - p.y) * h)
      if (band === 'left') g.scale(-1, 1)
      if (band === 'top') g.rotate(Math.PI / 2)
      drawNumber(g, livery.number, 0, 0, p.radius * h)
      g.restore()
    }
    g.restore()
  })
}
