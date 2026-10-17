# Development

driftline is a Trackmania-like browser racing game. Vite + TypeScript + three.js (WebGPU, WebGL2 fallback).

```bash
make run        # dev server (installs deps if needed); drive: WASD / arrows, Space = handbrake; ?renderer=webgl2 forces WebGL2
make test
make build
```

See [`VISION.md`](../VISION.md) and [`AGENTS.md`](../AGENTS.md). Tracks, the track groups, the single-feature test tracks and track themes: [`tracks.md`](tracks.md). Building tracks from pieces: [`track-kit.md`](track-kit.md).

## Laps

A race is 1 lap by default. Pick 1–10 laps under **Laps** in the start-screen / Esc-menu settings (saved in localStorage), or pass `?laps=N` (e.g. `?track=test2&laps=3`), which overrides the saved setting. In a multi-lap race the HUD shows `LAP 1/3`, split deltas flash at every checkpoint and lap line, and the finish panel shows the total time plus each lap time with the best lap marked. Best time, splits and the top-10 board are kept separately per lap count (1-lap records keep their original keys); medals are single-lap only. The ghost replays the session's best single lap at the start of every lap. R respawns at the current lap's last checkpoint; Backspace restarts at lap 1.

## Cars

The player car is picked at build time from the registry in `src/render/cars.ts`:

```bash
VITE_CAR=stadium make build   # race (default) | stadium | raceFuture | box
```

An unknown id falls back to `box`. New entries must use CC0, CC-BY or MIT assets with their licence under `assets/LICENSES/`, and must never be Nadeo-derived.

**Livery.** Settings → *Livery*, *Colour* and *Race number* paint the car at once (saved in localStorage, `driftline-settings`): six code-drawn patterns (`solid`, `stripes`, `chevrons`, `two-tone`, `checker`, `flag`) on eight paints, with the number on the nose deck and both sides. The ghost always wears `ghostLivery()` of yours — the next pattern and the paint whose hue is furthest away, at least 90° (`src/render/car/livery.ts`). Painting (`src/render/car/paint.ts`) moves the body's paint triangles — saturated colormap texels on a Kenney glb, clearcoat materials on a code-built car — into a child mesh with UVs into a four-band atlas (top, left, right, ends); wheels, glass and trim keep their own materials.

## Debug screenshots

- `?track=test2&x=-108&y=0.8&z=-59&yaw=90` spawns the car at that pose (yaw in degrees, 0 = +z, CCW positive). Without all four params the car spawns at the start line as usual. The HUD shows the current `yaw` in the same convention; press `P` to copy the current pose as a full `?track&x&y&z&yaw&freeze=1` URL (a toast confirms).
- The small corner text (pose, fps, build label) is the debug overlay; backtick (`` ` ``) toggles it and `&debug=0` starts it hidden. The race HUD (timer, speed, LAP / CP, splits) is separate and always shown. `H` shows every key binding (also Esc → Controls).
- `&freeze=1` holds physics and the countdown and hides the Begin overlay, so the frame is stable. Add `&renderer=webgl2` in headless browsers (headless WebGPU renders blank).
- `&time=morning|noon|sunset|night` and `&weather=sunny|cloudy|overcast|rain` pick the time of day and weather, each on its own; `&seed=<n>` replays a random pick (the debug line shows it as `random #<n>`). Without them a race uses the Settings *Time of day* and *Weather* choices — *Track default* (the track's `environment`), *Random* (a seeded pick) or one preset, each field on its own — which also switch the running race live (`src/track/environment.ts`, look in `src/render/environment.ts`, live apply in `src/menu/live.ts`). The URL params win at load only.
- `&ghost=show` stands the ghost car 4 m to the car's left, in its pose and livery, with no best lap needed — for livery shots.
- `&cam=top` swaps the chase camera for one straight above the track, framing the whole lap (fog off), e.g. `?track=test2&cam=top&freeze=1&renderer=webgl2`.
- `&cam=fly` opens the free-fly camera instead: the same `x&y&z&yaw` (plus `&pitch`, degrees, up positive) place the camera, not the car, e.g. `?track=test2&x=-60&y=40&z=-120&yaw=30&pitch=-25&cam=fly&freeze=1&renderer=webgl2`; `&orbit=1` starts a slow orbit of the whole track. In game, `C` toggles fly mode (race, ghost and audio hold still; `C` or `1`/`2`/`3` returns), WASD / arrows move, mouse drag looks, `E`/`Q` rise/sink, Shift is fast, `O` orbits. `P` while flying copies this fly-view URL.
- `make shots` (`npm run shots [-- test1 test-ramp]`, env `STEP=20`, `OUT=shots`; default: every Test-group track) starts a Vite dev server, walks each lap's centreline every `STEP` metres and writes `shots/<lap>/NNN.png` (gitignored). First run: `npx playwright install chromium-headless-shell`.

## Deploy

Every merge to `master` builds and deploys to https://bborbe.github.io/driftline/ via `.github/workflows/pages.yml` (GitHub Pages, source: GitHub Actions). The deployed commit SHA is in the page's `<meta name="commit">` tag.
