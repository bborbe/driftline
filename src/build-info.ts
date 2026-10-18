declare const __COMMIT_SHA__: string
declare const __BUILD_TIME__: string
declare const __APP_VERSION__: string

/** `<short-sha> · <YYYY-MM-DD HH:MM>Z · v<version>` — the label shown in the bottom-right corner. */
export function formatBuildLabel(sha: string, isoTime: string, version: string): string {
  const time = `${isoTime.slice(0, 10)} ${isoTime.slice(11, 16)}Z`
  return `${sha.slice(0, 7)} · ${time} · v${version}`
}

/** This build's label; values are injected by `define` in vite.config.ts. */
export const buildLabel = (): string => formatBuildLabel(__COMMIT_SHA__, __BUILD_TIME__, __APP_VERSION__)

/** Adds the build label to the page (debug overlay, dev only); Settings → About shows it in every build. */
export function mountBuildLabel(): void {
  const label = document.createElement('div')
  label.id = 'build'
  label.textContent = buildLabel()
  label.title = __COMMIT_SHA__
  document.body.appendChild(label)
}
