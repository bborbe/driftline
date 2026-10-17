# AGENTS.md

Instructions for coding agents working on driftline. Read `VISION.md` first.

## Commands

Use the Makefile targets; each installs dependencies first when `node_modules` is missing or stale.

| Command | Wraps | What it does |
|---|---|---|
| `make run` | `npm run dev` | Start the Vite dev server (open the printed URL; `?renderer=webgl2` forces the WebGL2 fallback) |
| `make test` | `npm test` | Run all unit tests (vitest) — must be green before every commit |
| `make build` | `npm run build` | Typecheck (`tsc`) and production build |
| `make shots` | `npm run shots` | Debug PNGs along each lap's centreline into `shots/` (docs/development.md § Debug screenshots; `?x&y&z&yaw&freeze=1` spawn params) |
| `VITE_CAR=<id> make build` | `npm run build` | Build with a specific car from `src/render/cars.ts` (`race` default, `stadium`, `raceFuture`, `box`; unknown ids fall back to `box`). Works with `make run` too |

## Layout

| Path | Role |
|---|---|
| `src/physics/` | Car simulation. Fixed 100 Hz tick (`step`, `FixedStepper`). Pure TypeScript. Per-material handling in `MATERIALS` (`car.ts`): the open ground beside the track is `offroad` — low grip, drag and a 10 m/s cap — so cuts never pay; `src/race/cuts.test.ts` proves it for every leg and corner of the shipped laps. Where a cut still pays, add a wall under `barriers` in the track JSON, or `"walls"` on the placements of a kit track (`barrierPillars()` feeds the collider and the render). Turbo pads boost only a car travelling within 60° of their arrow (`TURBO_ALIGN`); the arrow is `padForward()` in `src/track/shapes.ts` (along the segment, or back down it with `"reverse": true` on the zone), the one source for the boost check and the chevrons. Effect pads (`no-steer`, `engine-off`, `cruise`, `slow-mo`, `fragile`, `reset` zones) never touch handling: `src/race/effects.ts` (owned by `LapLoop`) gates the per-tick input `FixedStepper.advance` asks for, and `step()` only reads the optional `CarInput.timeScale` slow-mo sets. The ghost records the gated inputs from `sim.fed` (`GhostRecorder.consume`), so replays need no effect logic. |
| `src/camera/chase.ts` | Chase camera math (position, speed-based FOV). Pure TypeScript. |
| `src/race/` | Lap loop: no input until Begin (`race.start()`, wired to the audio Begin overlay) and the 3-2-1 countdown, ordered checkpoint gates, lap timer, respawn (R) / restart (Backspace, Esc → Restart, finish → Improve; ghost back on the grid at once), checkpoint split deltas vs the personal best, per-track medals (`medals` in the track JSON, best medal persisted), auto-respawn when the car falls 5 m below the ground or is airborne > 3 s, best time + top-10 leaderboard (L) in localStorage, Esc pause (also on tab hide; freezes tick, timer, ghost and audio). Every countdown, Begin and every restart, is 3-2-1-GO at 1 s per step (`src/race/countdown-timing.test.ts`, 60 and 144 Hz frames). Race HUD in `view.ts` / `race.css` (timer bottom centre, speedometer bottom right, medal target top left, LAP / CP top right, split pop-up, start lights + 3-2-1-GO!), sized in `vmin`; its values come from `hud.ts`. `lap.ts`, `medals.ts`, `store.ts` and `hud.ts` are pure and tested; `start-board.ts` maps the countdown to the start lamps (red one by one, then all green) and the start-arch screen text, one mapping for the HUD lights and the 3D start arch (`src/render/track/start-dressing.ts`: pillar start lights, arch screens over the start model's panels, road logo + grid box), fed by `race.board()` each frame; `index.ts` is the one `initRace()` + `race.frame()` hook for `main.ts`. Emits `lapStart` / `checkpoint` / `lapFinish` / `respawn` / `restart` to listeners (audio, ghost). |
| `src/track/kit.ts` | Trackmania-style piece kit: `KIT_PIECES` (straights, curves r 10/20/30, hairpin, slopes, bump, banks incl. the r 80 m flat-out `bank-180-wide`, the r 15 m `loop`, turbo pads, checkpoint, start, walled; any ground-level placement can add road-following `walls`) on a grid (`CELL` 10 m, `LEVEL` 4 m) with typed connectors. A track file with a `kit` block (`{ start, pieces[] }`, e.g. `assets/track/test-kit.json`) compiles to a plain `Track` via `resolveTrack()`, so physics and render need no kit code. `kit.test.ts` proves every piece pair joins with no gap or step. Pure and tested. Piece catalogue with screenshots: `docs/track-kit.md`; `test-kit-all` uses every piece but `bank-180-wide` (on `flatout`) and `loop` (on `test-loop`, S06 `looping`; `docs/track-kit.md` § loop). |
| `src/track/catalogue.ts` | Campaign levels (id, tier), the Styles group (`STYLES`, S01–S05, one kit track per Trackmania map style) and the Test-track order, `lap1`/`lap2` aliases, `nextInGroup` for Next track. Pure and tested. Track files are `assets/track/*.json`; a new test track is named `test-<feature>`, ≤ 20 s and autopilot-lapped in `src/race/full-lap.test.ts`. |
| `src/build-info.ts` | Bottom-right build label (short SHA · UTC build time · version). Values come from `define` in `vite.config.ts`, fed by `VITE_COMMIT_SHA` (CI) or `git rev-parse HEAD` (local) — the same value as the `<meta name="commit">` tag. |
| `src/input.ts` | Keyboard → `CarInput` (WASD / arrows, Space = handbrake) |
| `src/camera/fly.ts` | Free-fly camera (C, `?cam=fly`, `&pitch`, `&orbit=1`): pose integration, ground clamp, mouse look, track orbit, the P fly-view URL. Pure TypeScript; `main.ts` freezes race, ghost and audio while it is active |
| `src/camera/controller.ts` | Camera wiring: view keys 1/2/3, fly (C) and orbit (O) mode state, mouse look, and placing the three.js camera each frame from `chase.ts` / `fly.ts` / `views.ts` |
| `src/camera/views.ts` | Camera view keys 1 / 2 / 3 (close chase, far chase, in-car), persisted in localStorage |
| `src/fullscreen.ts` | F toggles fullscreen; an Esc that only leaves fullscreen does not pause |
| `src/physics/handling.ts`, `src/debug/tuning*.ts` | Handling config + dev tuning panel. Every tunable car constant lives in `DEFAULT_HANDLING`; `step()` reads the live config (`handling()`) each tick, so the defaults are bit-identical to the old literals. `?dev=1` + F2 opens a slider per constant (Engine / Grip / Steering / Drift / Air), each with its default and a reset; a tune persists in localStorage (`driftline-tuning`, loaded only with `?dev=1`) and moves as JSON (Copy / Apply). A run that ran tuned at any tick shows a TUNED badge and saves no best, splits, medal, board entry or ghost (`RunTaint`). A new handling constant goes into `Handling`, `DEFAULT_HANDLING` and `TUNING_GROUPS` (`tuning.test.ts` checks coverage). |
| `src/debug/overlay.ts` | Debug overlay: pose readout, build label, backtick toggle, P copies the debug-spawn URL (toast) |
| `src/main.ts` | three.js shell: boot (renderer, scene, race, ghost, audio), the one shell keydown dispatch, frame loop. Camera wiring lives in `src/camera/controller.ts`, the debug overlay in `src/debug/overlay.ts`; a new shell feature gets its own module, not a block here. The debug overlay (pose, fps, build label) stays in the corners, small, and never repeats race-HUD values; backtick toggles it, `?debug=0` starts it hidden. `H` is controls help: a new key binding goes into `CONTROLS` in `src/race/controls.ts` (one list for the H panel and Esc → Controls; its test names every bound key). Keep it on by default: agents read it in screenshots. |

## Rules

- **Physics isolation:** nothing under `src/physics/` may import `three` or any browser API. It must stay pure and deterministic — no `Math.random`, `Date`, or `performance.now`. Time enters only as the fixed `DT`.
- **Determinism is tested:** `src/physics/car.test.ts` runs 1000 scripted ticks twice and requires bit-identical state. Any physics change must keep it green.
- **Handling thresholds are tested** (0→20 m/s ≤ 3 s, 20→0 within 30 m, drift slip > 15°, a step steer at 100–140 km/h overshoots its settled yaw rate by ≤ 30% and reaches 63% within 120 ms, ice 0→60 km/h within 2× road, at 90 km/h a 0.25 s handbrake tap slides and no press up to 2 s spins, with the slide kept at speed on throttle, and a 0.25–0.6 s tap at the entry of a 40 m corner stays on the road above 75 km/h). Retune constants in `DEFAULT_HANDLING` (`src/physics/handling.ts`), never loosen a test to make it pass. Where a handling change makes a grass cut pay, close it with a barrier in the track JSON.
- The renderer logs `renderer: WebGPU` or `renderer: WebGL2` on startup; keep that line, it is how runs are verified.
- **Original assets only** — no Nadeo assets, branding, or decompiled code.

### Always hold

The why for each rule is in the PR it cites and in the operator's *3D Browser Game Development Guide*.

- **One shape, one function:** collider and mesh come from the same function in `src/track/` (`pose.ts` for every segment's length, pose, roll and width — `widthAt()`, default `ROAD_WIDTH`; `bank.ts`, `gatePillars()`, `gateLine()`). A new segment type is one case in `pose.ts`, not a copy in render, physics or the autopilot. Never draw a second formula for a shape physics already knows; render vertices match physics raycasts within 1 mm (#21, #25, #38, #45).
- **Render interpolates:** draw `FixedStepper.render()` (blends the last two ticks by `alpha = accumulator / DT`), never the latest tick; snap when state is replaced outside `advance()` (#37).
- **Road width is per segment, never by radius:** a segment's `width` (a number, or `[entry, exit]` to taper; kit placements take it too) is read only through `widthAt()`. Change width with a taper inside a segment, never a step at a joint (`kenney-plan.test.ts`). Never scale a corner model by radius; draw non-native radii and any non-CELL-wide corner procedurally (#23). The kit grid `CELL` stays 10 m whatever the road width.
- **Decals sit above the road:** road top + 3 mm, `polygonOffset(-1,-1)`, `depthWrite` off, clipped to the asphalt (#47). Double-sided casters use `shadowSide = BackSide` (#26).
- **Assets resolve on Pages:** bundle every texture a glb references (`import.meta.glob(?url)` + `setURLModifier`); check with `vite preview` under `/driftline/`, not only `make run` (#26).
- **Tests drive the real path:** no hand-set flags the game never produces; go through `advanceRace` / the autopilot lap (#12, #17, #22).
- **Records are keyed by layout:** `driftline-best-<track>-<layoutId>[-lapsN]` (test1, formerly lap1, keeps its legacy key; test2 keeps lap2's — `recordName` in `src/track/catalogue.ts`); a layout or lap-count change gets a new key (#30, #46).
- **Audio is synthesized:** no audio files; every loop fades to silence on finish (#50).
- **Jumps land tangent to the arc:** a launch lip of ≤ 6°, then a landing slope that continues the line from the lip (gap fall ≈ gap length · slope), long enough for a flat-out car; the touchdown angle is then nearly speed-independent. `src/race/jump-landing.test.ts` pins ≤ 15° off the surface and ≤ 10% speed loss at autopilot pace and flat out on test-ramp, crossover, tower and leap (the kit's `gap-jump` piece).
- **No paper-thin or floating geometry:** `src/render/geometry-lint.test.ts` builds every shipped track's scene headlessly and runs `lintScene()` (`src/render/lint.ts`). A closed part must be at least `MIN_THICKNESS` (0.15 m) thick; an open sheet may end only on the ground or against another surface (a wall end standing free in the air is paper); a structural part must stand on the ground or on something within `CONTACT_TOLERANCE` (0.05 m) below it. Tag new geometry where you create it (`src/render/tags.ts`): `structural(mesh, kind)` for walls, pillars, gate legs, decks, ramp bodies, stands and signs, `flat(mesh, reason)` with a reason from `FLAT_REASONS` for a piece that is flat on purpose (road, curb, decal, pad, screen face, …). Never tag a real offender flat to silence the lint; list it in the test's `KNOWN` with its follow-up instead.
- **Assets are CC0 / CC-BY / MIT** and listed in `assets/LICENSES/` (#3).

## Workflow

Feature branch + pull request into `master`, merged with a merge commit (`gh pr merge --merge`). No releases or tags.

- **Single-feature tracks stay short (≤ 20 s autopilot lap)** except where the mechanic needs top speed: test-ramp and test-flat carry a full-throttle run-up, pinned by `src/race/run-up.test.ts` (ramp entry 130–147 km/h; S-bend ≥ 130 km/h).
- **Visual changes are verified with the debug spawn** (docs/development.md § Debug screenshots): before reporting, shoot the change from the chase cam and from off-track (side, below) on test1, test2 and the single-feature test track for the mechanic you touched (`test-ramp`, `test-bank`, `test-surfaces`, … — docs/tracks.md; `?x&y&z&yaw&freeze=1`, `&cam=top`, `make shots`) and judge shape and material, not only seams. A fix for a reported visual bug also gets a shot of the reporter's exact pose on the live site once its `<meta name="commit">` shows the merge.
