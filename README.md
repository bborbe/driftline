# driftline

Private Trackmania-like browser racing game. Vite + TypeScript + three.js (WebGPU, WebGL2 fallback).

```bash
make run        # dev server (installs deps if needed); drive: WASD / arrows, Space = handbrake; ?renderer=webgl2 forces WebGL2
make test
make build
```

See `VISION.md` and `AGENTS.md`.

## Tracks

The start screen shows two groups (↑/↓ switches group, ←/→ picks a track); **Next track** on the finish panel stays inside the group.

- **Campaign** — numbered levels (`A01`, `A02`, …) in difficulty tiers (white → green → blue → red → black), each with author/gold/silver/bronze medals. Order and tiers live in `src/track/catalogue.ts`; a level is listed once its `assets/track/<name>.json` ships.
  - `A01 crossover` and `A02 tower` are multi-level: the road climbs onto concrete decks on pillars and passes over itself. crossover is a figure-eight with an 8 m bridge over the start straight, then a 14 m gap jump (a `gap` segment is open air). tower has a 60 m climb into a steep 34° banked 180 at 12 m, a bridge over the start straight and a 12 m drop into a banked turn. A checkpoint counts from 2 m below its road to 20 m above, so a road under a deck gate never triggers it, while a full-throttle jump over the arch still does.
- **Test** — tracks for checking one thing fast. `test1` and `test2` are the original lap1/lap2 (`?track=lap1` / `?track=lap2` still open them, and their best times, boards and medals carry over). The single-feature tracks are short ovals that an autopilot laps in ≤ 20 s with no respawn:

| Track | Checks |
|---|---|
| `test-flat` | grip, acceleration, top speed, hairpins |
| `test-ramp` | ramp jump and landing |
| `test-bank` | banked 180° turns |
| `test-surfaces` | asphalt → dirt → ice → grass strips |
| `test-turbo` | yellow and red turbo pads |
| `test-checkpoint` | four checkpoints in a row: split deltas, respawn at the last one |

Any other `assets/track/test*.json` joins the Test group; any other track joins the end of the campaign.

## Laps

A race is 1 lap by default. Pick 1–10 laps under **Laps** in the start-screen / Esc-menu settings (saved in localStorage), or pass `?laps=N` (e.g. `?track=test2&laps=3`), which overrides the saved setting. In a multi-lap race the HUD shows `LAP 1/3`, split deltas flash at every checkpoint and lap line, and the finish panel shows the total time plus each lap time with the best lap marked. Best time, splits and the top-10 board are kept separately per lap count (1-lap records keep their original keys); medals are single-lap only. The ghost replays the session's best single lap at the start of every lap. R respawns at the current lap's last checkpoint; Backspace restarts at lap 1.

## Cars

The player car is picked at build time from the registry in `src/render/cars.ts`:

```bash
VITE_CAR=stadium make build   # race (default) | stadium | raceFuture | box
```

An unknown id falls back to `box`. New entries must use CC0, CC-BY or MIT assets with their licence under `assets/LICENSES/`, and must never be Nadeo-derived.

## Debug screenshots

- `?track=test2&x=-108&y=0.8&z=-59&yaw=90` spawns the car at that pose (yaw in degrees, 0 = +z, CCW positive). Without all four params the car spawns at the start line as usual. The HUD shows the current `yaw` in the same convention; press `P` to copy the current pose as a full `?track&x&y&z&yaw&freeze=1` URL (a toast confirms).
- `&freeze=1` holds physics and the countdown and hides the Begin overlay, so the frame is stable. Add `&renderer=webgl2` in headless browsers (headless WebGPU renders blank).
- `&cam=top` swaps the chase camera for one straight above the track, framing the whole lap (fog off), e.g. `?track=test2&cam=top&freeze=1&renderer=webgl2`.
- `&cam=fly` opens the free-fly camera instead: the same `x&y&z&yaw` (plus `&pitch`, degrees, up positive) place the camera, not the car, e.g. `?track=test2&x=-60&y=40&z=-120&yaw=30&pitch=-25&cam=fly&freeze=1&renderer=webgl2`; `&orbit=1` starts a slow orbit of the whole track. In game, `C` toggles fly mode (race, ghost and audio hold still; `C` or `1`/`2`/`3` returns), WASD / arrows move, mouse drag looks, `E`/`Q` rise/sink, Shift is fast, `O` orbits. `P` while flying copies this fly-view URL.
- `make shots` (`npm run shots [-- test1 test-ramp]`, env `STEP=20`, `OUT=shots`; default: every Test-group track) starts a Vite dev server, walks each lap's centreline every `STEP` metres and writes `shots/<lap>/NNN.png` (gitignored). First run: `npx playwright install chromium-headless-shell`.

## Deploy

Every merge to `master` builds and deploys to https://bborbe.github.io/driftline/ via `.github/workflows/pages.yml` (GitHub Pages, source: GitHub Actions). The deployed commit SHA is in the page's `<meta name="commit">` tag.
