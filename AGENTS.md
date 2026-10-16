# AGENTS.md

Instructions for coding agents working on driftline. Read `VISION.md` first.

## Commands

Use the Makefile targets; each installs dependencies first when `node_modules` is missing or stale.

| Command | Wraps | What it does |
|---|---|---|
| `make run` | `npm run dev` | Start the Vite dev server (open the printed URL; `?renderer=webgl2` forces the WebGL2 fallback) |
| `make test` | `npm test` | Run all unit tests (vitest) — must be green before every commit |
| `make build` | `npm run build` | Typecheck (`tsc`) and production build |
| `VITE_CAR=<id> make build` | `npm run build` | Build with a specific car from `src/render/cars.ts` (`stadium` default, `race`, `raceFuture`, `box`; unknown ids fall back to `box`). Works with `make run` too |

## Layout

| Path | Role |
|---|---|
| `src/physics/` | Car simulation. Fixed 100 Hz tick (`step`, `FixedStepper`). Pure TypeScript. |
| `src/camera/chase.ts` | Chase camera math (position, speed-based FOV). Pure TypeScript. |
| `src/race/` | Lap loop: no input until Begin (`race.start()`, wired to the audio Begin overlay) and the 3-2-1 countdown, ordered checkpoint gates, lap timer, respawn (R) / restart (Backspace), auto-respawn when the car falls 5 m below the ground or is airborne > 3 s, best time + top-10 leaderboard (L) in localStorage. `lap.ts` and `store.ts` are pure and tested; `index.ts` is the one `initRace()` + `race.frame()` hook for `main.ts`. Emits `lapStart` / `checkpoint` / `lapFinish` / `respawn` to listeners (audio, ghost). |
| `src/input.ts` | Keyboard → `CarInput` (WASD / arrows, Space = handbrake) |
| `src/main.ts` | three.js shell: renderer (WebGPU, WebGL2 fallback), scene, HUD, frame loop |

## Rules

- **Physics isolation:** nothing under `src/physics/` may import `three` or any browser API. It must stay pure and deterministic — no `Math.random`, `Date`, or `performance.now`. Time enters only as the fixed `DT`.
- **Determinism is tested:** `src/physics/car.test.ts` runs 1000 scripted ticks twice and requires bit-identical state. Any physics change must keep it green.
- **Handling thresholds are tested** (0→20 m/s ≤ 3 s, 20→0 within 30 m, drift slip > 15°). Retune constants in `car.ts`, never loosen a test to make it pass.
- The renderer logs `renderer: WebGPU` or `renderer: WebGL2` on startup; keep that line, it is how runs are verified.
- **Original assets only** — no Nadeo assets, branding, or decompiled code.

## Workflow

Feature branch + pull request into `master`, merged with a merge commit (`gh pr merge --merge`). No releases or tags.
