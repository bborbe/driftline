// F toggles browser fullscreen. Esc leaves fullscreen natively; that same Esc must not also pause.
const GRACE_MS = 250 // an Esc keydown this soon after leaving fullscreen belongs to the exit

let exitedAt = -Infinity

/** True when an Escape keydown at `now` is the browser's fullscreen exit, not a pause request. */
export const escapeLeavesFullscreen = (inFullscreen: boolean, now: number, lastExit: number = exitedAt): boolean =>
  inFullscreen || now - lastExit < GRACE_MS

export const toggleFullscreen = (): void => {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen().catch(() => {})
}

/** Track fullscreen exits and call onResize on every fullscreen change. */
export const watchFullscreen = (onResize: () => void): void => {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) exitedAt = performance.now()
    onResize()
  })
}
