# AGENTS.md

Instructions for coding agents working on driftline. Read `VISION.md` first.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the Vite dev server (open the printed URL; `?renderer=webgl2` forces the WebGL2 fallback) |
| `npm test` | Run all unit tests (vitest) — must be green before every commit |
| `npm run build` | Typecheck (`tsc`) and production build |

## Layout

| Path | Role |
|---|---|
| `src/physics/` | Car simulation. Fixed 100 Hz tick (`step`, `FixedStepper`). Pure TypeScript. |
| `src/camera/chase.ts` | Chase camera math (position, speed-based FOV). Pure TypeScript. |
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
