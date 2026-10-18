// Challenge UI: the target banner over the race, the error a bad link shows on the menu, the copy toast and the name
// tag over the challenger's ghost (a scene sprite). Link encoding lives in link.ts; main.ts wires these up.
import * as THREE from 'three/webgpu'
import './challenge.css'
import { formatLapTime } from '../race/store'
import type { Challenge } from './link'

/** Shown for a challenge sent without a name. */
export const DEFAULT_CHALLENGER = 'CHALLENGER'
export const challengerName = (c: Pick<Challenge, 'name'>): string => c.name || DEFAULT_CHALLENGER

const el = (tag: string, cls: string, text = ''): HTMLElement => Object.assign(document.createElement(tag), { className: cls, textContent: text })

/** Top-centre banner for the whole race: who set the target and the time to beat. */
export function mountChallengeBanner(c: Challenge): HTMLElement {
  const box = el('div', 'challenge-banner')
  box.id = 'challenge-target'
  box.append(el('span', 'challenge-label', 'CHALLENGE'), el('span', 'challenge-name', challengerName(c)), el('span', 'challenge-time', formatLapTime(c.targetMs)))
  if (!c.ghost) box.append(el('span', 'challenge-label', 'NO GHOST'))
  document.documentElement.classList.add('challenge-on')
  document.body.append(box)
  return box
}

/** The error a link that could not be read shows over the menu; click to dismiss. */
export function showChallengeError(reason: string): HTMLElement {
  const box = el('div', 'challenge-error', `Challenge link could not be loaded: ${reason}`)
  box.id = 'challenge-error'
  box.setAttribute('role', 'alert')
  box.addEventListener('click', () => box.remove())
  document.body.append(box)
  return box
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
/** A short note at the top of the screen ("Challenge link copied"), above the results card. */
export function challengeToast(text: string): void {
  let t = document.getElementById('challenge-toast')
  if (!t) {
    t = el('div', 'challenge-toast')
    t.id = 'challenge-toast'
    document.body.append(t)
  }
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400)
}

/** Copies `url` to the clipboard; false when the browser refuses (no permission, insecure context). */
export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

const ABOVE = 1.6 // m over the ghost's origin: above the roof
const TAG_HEIGHT = 0.045 // screen-size sprite (sizeAttenuation off): about 4 % of the view height

/**
 * A name label over the ghost car: a sprite in the scene, drawn on top and the same size at any distance. It follows
 * the ghost by copying its position each frame, so no DOM is touched per frame.
 */
export function createGhostTag(name: string, scene: THREE.Object3D): { update(ghost: THREE.Object3D): void } {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = 'bold 40px system-ui, sans-serif'
  ctx.font = font
  canvas.width = Math.ceil(ctx.measureText(name).width) + 32
  canvas.height = 56
  ctx.font = font
  ctx.fillStyle = 'rgba(10, 14, 22, 0.6)'
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, canvas.height, 10)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }))
  sprite.center.set(0.5, 0)
  sprite.scale.set((TAG_HEIGHT * canvas.width) / canvas.height, TAG_HEIGHT, 1)
  sprite.renderOrder = 10
  sprite.name = 'challenge-tag'
  sprite.visible = false
  scene.add(sprite)
  return {
    update(ghost) {
      sprite.visible = ghost.visible
      sprite.position.set(ghost.position.x, ghost.position.y + ABOVE, ghost.position.z)
    },
  }
}
