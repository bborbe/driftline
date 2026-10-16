# driftline

Private Trackmania-like browser racing game. Vite + TypeScript + three.js (WebGPU, WebGL2 fallback).

```bash
make run        # dev server (installs deps if needed); drive: WASD / arrows, Space = handbrake; ?renderer=webgl2 forces WebGL2
make test
make build
```

See `VISION.md` and `AGENTS.md`.

## Laps

A race is 1 lap by default. Pick 1–10 laps under **Laps** in the start-screen / Esc-menu settings (saved in localStorage), or pass `?laps=N` (e.g. `?track=lap2&laps=3`), which overrides the saved setting. In a multi-lap race the HUD shows `LAP 1/3`, split deltas flash at every checkpoint and lap line, and the finish panel shows the total time plus each lap time with the best lap marked. Best time, splits and the top-10 board are kept separately per lap count (1-lap records keep their original keys); medals are single-lap only. The ghost replays the session's best single lap at the start of every lap. R respawns at the current lap's last checkpoint; Backspace restarts at lap 1.

## Cars

The player car is picked at build time from the registry in `src/render/cars.ts`:

```bash
VITE_CAR=stadium make build   # race (default) | stadium | raceFuture | box
```

An unknown id falls back to `box`. New entries must use CC0, CC-BY or MIT assets with their licence under `assets/LICENSES/`, and must never be Nadeo-derived.

## Debug screenshots

- `?track=lap2&x=-108&y=0.8&z=-59&yaw=90` spawns the car at that pose (yaw in degrees, 0 = +z, CCW positive). Without all four params the car spawns at the start line as usual. The HUD shows the current `yaw` in the same convention; press `P` to copy the current pose as a full `?track&x&y&z&yaw&freeze=1` URL (a toast confirms).
- The small corner text (pose, fps, build label, key hints) is the debug overlay; `H` toggles it and `&debug=0` starts it hidden. The race HUD (timer, speed, LAP / CP, splits) is separate and always shown.
- `&freeze=1` holds physics and the countdown and hides the Begin overlay, so the frame is stable. Add `&renderer=webgl2` in headless browsers (headless WebGPU renders blank).
- `&cam=top` swaps the chase camera for one straight above the track, framing the whole lap (fog off), e.g. `?track=lap2&cam=top&freeze=1&renderer=webgl2`.
- `make shots` (`npm run shots [-- lap1 lap2]`, env `STEP=20`, `OUT=shots`) starts a Vite dev server, walks each lap's centreline every `STEP` metres and writes `shots/<lap>/NNN.png` (gitignored). First run: `npx playwright install chromium-headless-shell`.

## Deploy

Every merge to `master` builds and deploys to https://bborbe.github.io/driftline/ via `.github/workflows/pages.yml` (GitHub Pages, source: GitHub Actions). The deployed commit SHA is in the page's `<meta name="commit">` tag.
