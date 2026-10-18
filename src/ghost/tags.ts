// Floating ghost name tags: one DOM label per ghost, pinned above its car on screen. The text comes from tag.ts;
// this module only projects, stacks and clamps: a tag never leaves the viewport or covers a standing race HUD panel
// (it steps up above one, and hides when that would lift it far off its car). The brief centre pop-ups (split,
// countdown) paint over the tags instead of pushing them away: the tags sit before the HUD in the DOM.
import * as THREE from 'three/webgpu'
import type { Vec3 } from '../physics'
import type { GhostKind, TagText } from './tag'

/** Height above the car's origin the tag points at (m). */
const LIFT = 1.6

/** Farthest a tag steps up off its car to clear a panel or another tag, as a share of the viewport height. */
const MAX_STEP = 0.3

/** Standing race HUD panels a tag must not cover (src/race/view.ts). */
const HUD_PANELS = '.race-status, .race-time, .race-speedo'

/** Frames between re-reading the panels' rects and the tags' sizes (they change at a checkpoint, a resize or a HUD-scale change). */
const PANEL_EVERY = 15

export interface TagInput {
  kind: GhostKind
  position: Vec3
  text: TagText
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export interface GhostTags {
  update(tags: readonly TagInput[], camera: THREE.Camera): void
  hide(): void
}

export function createGhostTags(): GhostTags {
  /** Each tag's elements, its last detail class and its size, measured only when its text changes. */
  const els = new Map<GhostKind, { root: HTMLElement; name: HTMLElement; detail: HTMLElement; cls: string; w: number; h: number }>()
  const el = (kind: GhostKind) => {
    let e = els.get(kind)
    if (!e) {
      const root = Object.assign(document.createElement('div'), { className: `ghost-tag ghost-tag-${kind}` })
      const name = Object.assign(document.createElement('b'), { className: 'ghost-tag-name' })
      const detail = Object.assign(document.createElement('span'), { className: 'ghost-tag-detail' })
      root.append(name, detail)
      // Before the race HUD, so its pop-ups paint over the tags.
      const hud = document.querySelector('.race-status')
      if (hud) hud.before(root)
      else document.body.append(root)
      e = { root, name, detail, cls: '', w: 0, h: 0 }
      els.set(kind, e)
    }
    return e
  }
  const p = new THREE.Vector3()
  let blocked: Box[] = []
  let frames = 0
  const readPanels = () => {
    blocked = [...document.querySelectorAll(HUD_PANELS)]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }))
    for (const e of els.values()) [e.w, e.h] = [0, 0]
  }
  window.addEventListener('resize', () => (frames = 0))
  const hide = () => els.forEach((e) => (e.root.style.visibility = 'hidden'))

  return {
    hide,
    update(tags, camera) {
      camera.updateMatrixWorld()
      const w = window.innerWidth
      const h = window.innerHeight
      if (frames++ % PANEL_EVERY === 0) readPanels()
      // Project, then size every tag before placing any (one layout pass).
      const shown: { e: ReturnType<typeof el>; anchor: { x: number; y: number } }[] = []
      for (const t of tags) {
        const e = el(t.kind)
        p.set(t.position.x, t.position.y + LIFT, t.position.z).project(camera)
        if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) {
          e.root.style.visibility = 'hidden'
          continue
        }
        let changed = e.w === 0
        if (e.name.textContent !== t.text.name) [e.name.textContent, changed] = [t.text.name, true]
        if (e.detail.textContent !== t.text.detail) [e.detail.textContent, changed] = [t.text.detail, true]
        const cls = `ghost-tag-detail${t.text.ahead === null ? '' : t.text.ahead ? ' race-behind' : ' race-ahead'}`
        if (e.cls !== cls) [e.detail.className, e.cls] = [cls, cls]
        if (changed) [e.w, e.h] = [0, 0]
        shown.push({ e, anchor: { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h } })
      }
      for (const e of els.values()) if (!shown.some((s) => s.e === e)) e.root.style.visibility = 'hidden'
      // Measure only tags whose text changed (one layout read for all of them), then reuse the size.
      for (const s of shown) if (s.e.w === 0) [s.e.w, s.e.h] = [s.e.root.offsetWidth, s.e.root.offsetHeight]
      const sized = shown.map((s) => ({ ...s, tw: s.e.w, th: s.e.h }))
      // Nearest the bottom first (closest ghost, usually); later tags step up above any tag they would cover.
      sized.sort((a, b) => b.anchor.y - a.anchor.y)
      const placed: Box[] = []
      for (const s of sized) {
        const box: Box = { x: s.anchor.x - s.tw / 2, y: s.anchor.y - s.th, w: s.tw, h: s.th }
        box.x = Math.min(Math.max(box.x, 0), w - box.w)
        box.y = Math.min(box.y, h - box.h)
        const floor = box.y - MAX_STEP * h
        // Step up above whatever it would cover; every step moves it up, so this ends.
        for (let moved = true; moved && box.y >= floor; ) {
          moved = false
          for (const o of [...blocked, ...placed])
            if (overlaps(box, o)) {
              box.y = o.y - box.h - 2
              moved = true
            }
        }
        if (box.y < Math.max(0, floor)) {
          s.e.root.style.visibility = 'hidden'
          continue
        }
        placed.push(box)
        s.e.root.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`
        s.e.root.style.visibility = 'visible'
      }
    },
  }
}
