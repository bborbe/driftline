// Challenge UI: the target banner over the race, the error a bad link shows on the menu and the copy toast; the
// challenger's ghost carries its name on its ghost tag (src/ghost/tags.ts). Link encoding lives in link.ts; main.ts wires these up.
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

/** The error a link that could not be read shows over the menu; click, Esc or the pad's B dismisses it. */
export function showChallengeError(reason: string): HTMLElement {
  const box = el('div', 'challenge-error', `Challenge link could not be loaded: ${reason}`)
  box.id = 'challenge-error'
  box.setAttribute('role', 'alert')
  const dismiss = () => {
    box.remove()
    window.removeEventListener('keydown', onKey, true)
  }
  const onKey = (e: KeyboardEvent) => {
    if (!box.isConnected || e.code === 'Escape') dismiss()
  }
  box.addEventListener('click', dismiss)
  window.addEventListener('keydown', onKey, true)
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
