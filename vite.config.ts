import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// One source for the build identity: CI sets VITE_COMMIT_SHA (pages.yml), local builds fall back to git.
// Writing it back to process.env keeps the <meta name="commit"> tag in index.html on the same value.
function commitSha(): string {
  if (process.env.VITE_COMMIT_SHA) return process.env.VITE_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
process.env.VITE_COMMIT_SHA = commitSha()
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// Test tiers (docs/development.md § Test tiers). Slow = every file >= 2 s in CI (measured from the
// ci.yml log, vitest prints per-file times); everything else is fast. `npm test` runs fast only (every PR,
// `make test`); `npm run test:all` runs both (release.yml, nightly.yml, `make test-all`).
const SLOW_TESTS = [
  'src/race/cuts.test.ts',
  'src/race/full-lap.test.ts',
  'src/render/geometry-lint.test.ts',
  'src/race/jump-landing.test.ts',
  'src/race/golden-replay.test.ts',
  'src/render/decor/trackside-plan.test.ts',
  'src/render/track/geometry.test.ts',
  'src/physics/barriers.test.ts',
  'src/race/effects.test.ts',
  'src/race/loop-gate.test.ts',
]

// Served from https://bborbe.github.io/driftline/ (GitHub Pages project site); PR previews build under
// /driftline/pr-<n>/ by setting VITE_BASE (pages.yml).
export default defineConfig({
  base: process.env.VITE_BASE || '/driftline/',
  define: {
    __COMMIT_SHA__: JSON.stringify(process.env.VITE_COMMIT_SHA),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    projects: [
      { extends: true, test: { name: 'fast', include: ['src/**/*.test.ts'], exclude: SLOW_TESTS } },
      { extends: true, test: { name: 'slow', include: SLOW_TESTS } },
    ],
  },
})
