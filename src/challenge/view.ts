// Challenge UI: the target banner over the race, the error a bad link shows on the menu, the copy toast and the name
// tag over the challenger's ghost. Link encoding lives in link.ts; main.ts wires these up.
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
/** A short note at the bottom of the screen ("Challenge link copied"). */
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
const at = new THREE.Vector3()

/** A name label that follows the ghost car on screen; hidden when the ghost is hidden or behind the camera. */
export function mountGhostTag(name: string): { update(ghost: THREE.Object3D, camera: THREE.Camera): void } {
  const tag = el('div', 'challenge-tag', name)
  tag.id = 'challenge-tag'
  document.body.append(tag)
  return {
    update(ghost, camera) {
      // This frame's poses: the ghost and the camera moved since the last render updated their matrices.
      ghost.getWorldPosition(at)
      at.y += ABOVE
      camera.updateMatrixWorld()
      at.project(camera)
      const show = ghost.visible && at.z > -1 && at.z < 1 && Math.abs(at.x) < 1.1 && Math.abs(at.y) < 1.1
      tag.hidden = !show
      if (show) tag.style.transform = `translate(-50%, -100%) translate(${((at.x + 1) / 2) * innerWidth}px, ${((1 - at.y) / 2) * innerHeight}px)`
    },
  }
}
