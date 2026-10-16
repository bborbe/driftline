# AGENTS.md

Instructions for coding agents working on driftline. Read `VISION.md` first.

## Commands

Use the Makefile targets; each installs dependencies first when `node_modules` is missing or stale.

| Command | Wraps | What it does |
|---|---|---|
| `make run` | `npm run dev` | Start the Vite dev server (open the printed URL; `?renderer=webgl2` forces the WebGL2 fallback) |
| `make test` | `npm test` | Run all unit tests (vitest) — must be green before every commit |
| `make build` | `npm run build` | Typecheck (`tsc`) and production build |
| `make shots` | `npm run shots` | Debug PNGs along each lap's centreline into `shots/` (README § Debug screenshots; `?x&y&z&yaw&freeze=1` spawn params) |
| `VITE_CAR=<id> make build` | `npm run build` | Build with a specific car from `src/render/cars.ts` (`race` default, `stadium`, `raceFuture`, `box`; unknown ids fall back to `box`). Works with `make run` too |

## Layout

| Path | Role |
|---|---|
| `src/physics/` | Car simulation. Fixed 100 Hz tick (`step`, `FixedStepper`). Pure TypeScript. Per-material handling in `MATERIALS` (`car.ts`): the open ground beside the track is `offroad` — low grip, drag and a 10 m/s cap — so cuts never pay; `src/race/cuts.test.ts` proves it for every leg and corner of the shipped laps. Where a cut still pays, add a wall under `barriers` in the track JSON (`barrierPillars()` feeds the collider and the render). Turbo pads boost only a car travelling within 60° of their arrow (`TURBO_ALIGN`); the arrow is `padForward()` in `src/track/schema.ts` (along the segment, or back down it with `"reverse": true` on the zone), the one source for the boost check and the chevrons. |
| `src/camera/chase.ts` | Chase camera math (position, speed-based FOV). Pure TypeScript. |
| `src/race/` | Lap loop: no input until Begin (`race.start()`, wired to the audio Begin overlay) and the 3-2-1 countdown, ordered checkpoint gates, lap timer, respawn (R) / instant restart (Backspace, 0.8 s countdown; ghost back on the grid at once), checkpoint split deltas vs the personal best, per-track medals (`medals` in the track JSON, best medal persisted), auto-respawn when the car falls 5 m below the ground or is airborne > 3 s, best time + top-10 leaderboard (L) in localStorage, Esc pause (also on tab hide; freezes tick, timer, ghost and audio). Restart (Backspace) runs the same 3-2-1-GO compressed into 0.8 s. Race HUD in `view.ts` / `race.css` (timer bottom centre, speedometer bottom right, medal target top left, LAP / CP top right, split pop-up, start lights + 3-2-1-GO!), sized in `vmin`; its values come from `hud.ts`. `lap.ts`, `medals.ts`, `store.ts` and `hud.ts` are pure and tested; `index.ts` is the one `initRace()` + `race.frame()` hook for `main.ts`. Emits `lapStart` / `checkpoint` / `lapFinish` / `respawn` / `restart` to listeners (audio, ghost). |
| `src/track/kit.ts` | Trackmania-style piece kit: `KIT_PIECES` (straights, curves r 10/20/30, hairpin, slopes, bump, banks, turbo pads, checkpoint, start, walled) on a grid (`CELL` 10 m, `LEVEL` 4 m) with typed connectors. A track file with a `kit` block (`{ start, pieces[] }`, e.g. `assets/track/test-kit.json`) compiles to a plain `Track` via `resolveTrack()`, so physics and render need no kit code. `kit.test.ts` proves every piece pair joins with no gap or step. Pure and tested. Piece catalogue with screenshots: `docs/track-kit.md`; `test-kit-all` uses every piece. |
| `src/track/catalogue.ts` | Campaign levels (id, tier) and the Test-track order, `lap1`/`lap2` aliases, `nextInGroup` for Next track. Pure and tested. Track files are `assets/track/*.json`; a new test track is named `test-<feature>`, ≤ 20 s and autopilot-lapped in `src/race/full-lap.test.ts`. |
| `src/build-info.ts` | Bottom-right build label (short SHA · UTC build time · version). Values come from `define` in `vite.config.ts`, fed by `VITE_COMMIT_SHA` (CI) or `git rev-parse HEAD` (local) — the same value as the `<meta name="commit">` tag. |
| `src/input.ts` | Keyboard → `CarInput` (WASD / arrows, Space = handbrake) |
| `src/camera/fly.ts` | Free-fly camera (C, `?cam=fly`, `&pitch`, `&orbit=1`): pose integration, ground clamp, mouse look, track orbit, the P fly-view URL. Pure TypeScript; `main.ts` freezes race, ghost and audio while it is active |
| `src/camera/views.ts` | Camera view keys 1 / 2 / 3 (close chase, far chase, in-car), persisted in localStorage |
| `src/fullscreen.ts` | F toggles fullscreen; an Esc that only leaves fullscreen does not pause |
| `src/main.ts` | three.js shell: renderer (WebGPU, WebGL2 fallback), scene, debug overlay, frame loop. The debug overlay (pose, fps, build label) stays in the corners, small, and never repeats race-HUD values; backtick toggles it, `?debug=0` starts it hidden. `H` is controls help: a new key binding goes into `CONTROLS` in `src/race/controls.ts` (one list for the H panel and Esc → Controls; its test names every bound key). Keep it on by default: agents read it in screenshots. |

## Rules

- **Physics isolation:** nothing under `src/physics/` may import `three` or any browser API. It must stay pure and deterministic — no `Math.random`, `Date`, or `performance.now`. Time enters only as the fixed `DT`.
- **Determinism is tested:** `src/physics/car.test.ts` runs 1000 scripted ticks twice and requires bit-identical state. Any physics change must keep it green.
- **Handling thresholds are tested** (0→20 m/s ≤ 3 s, 20→0 within 30 m, drift slip > 15°). Retune constants in `car.ts`, never loosen a test to make it pass.
- The renderer logs `renderer: WebGPU` or `renderer: WebGL2` on startup; keep that line, it is how runs are verified.
- **Original assets only** — no Nadeo assets, branding, or decompiled code.

### Always hold

The why for each rule is in the PR it cites and in the operator's *3D Browser Game Development Guide*.

- **One shape, one function:** collider and mesh come from the same function in `src/track/` (`pose.ts` for every segment's length, pose, roll and `ROAD_WIDTH`; `bank.ts`, `gatePillars()`, `gateLine()`). A new segment type is one case in `pose.ts`, not a copy in render, physics or the autopilot. Never draw a second formula for a shape physics already knows; render vertices match physics raycasts within 1 mm (#21, #25, #38, #45).
- **Render interpolates:** draw `FixedStepper.render()` (blends the last two ticks by `alpha = accumulator / DT`), never the latest tick; snap when state is replaced outside `advance()` (#37).
- **Constant road width:** never scale a corner model by radius; draw non-native radii procedurally (#23).
- **Decals sit above the road:** road top + 3 mm, `polygonOffset(-1,-1)`, `depthWrite` off, clipped to the asphalt (#47). Double-sided casters use `shadowSide = BackSide` (#26).
- **Assets resolve on Pages:** bundle every texture a glb references (`import.meta.glob(?url)` + `setURLModifier`); check with `vite preview` under `/driftline/`, not only `make run` (#26).
- **Tests drive the real path:** no hand-set flags the game never produces; go through `advanceRace` / the autopilot lap (#12, #17, #22).
- **Records are keyed by layout:** `driftline-best-<track>-<layoutId>[-lapsN]` (test1, formerly lap1, keeps its legacy key; test2 keeps lap2's — `recordName` in `src/track/catalogue.ts`); a layout or lap-count change gets a new key (#30, #46).
- **Audio is synthesized:** no audio files; every loop fades to silence on finish (#50).
- **Assets are CC0 / CC-BY / MIT** and listed in `assets/LICENSES/` (#3).

## Workflow

Feature branch + pull request into `master`, merged with a merge commit (`gh pr merge --merge`). No releases or tags.

- **Visual changes are verified with the debug spawn** (README § Debug screenshots): before reporting, shoot the change from the chase cam and from off-track (side, below) on test1, test2 and the single-feature test track for the mechanic you touched (`test-ramp`, `test-bank`, `test-surfaces`, … — README § Tracks; `?x&y&z&yaw&freeze=1`, `&cam=top`, `make shots`) and judge shape and material, not only seams. A fix for a reported visual bug also gets a shot of the reporter's exact pose on the live site once its `<meta name="commit">` shows the merge.
