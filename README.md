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
  - `A01 crossover` and `A02 tower` are multi-level: the road climbs onto concrete decks on pillars and passes over itself. crossover is a figure-eight with an 8 m bridge over the start straight, then a 10 m gap jump (a `gap` segment is open air) onto a 74 m landing slope. tower has a 60 m climb into a steep 34° banked 180 at 12 m, a bridge over the start straight and a 12 m drop into a banked turn. A checkpoint counts from 2 m below its road to 20 m above, so a road under a deck gate never triggers it, while a full-throttle jump over the arch still does.
  - `A03 plunge`, `A04 knot` and `A05 leap` are built entirely from the [track piece kit](docs/track-kit.md), in rising difficulty. plunge climbs onto an 8 m deck and plunges two levels straight into a banked 180. knot is a figure-eight whose 8 m deck, entered and left through banked and deck curves, crosses over the start straight, then a dirt run and a hairpin switchback. leap climbs to 12 m and jumps a `gap-jump` onto a 4 m deck, banks round at 4 m, then ice into a banked 180, a red turbo and dirt.
- **Test** — tracks for checking one thing fast. `test1` and `test2` are the original lap1/lap2 (`?track=lap1` / `?track=lap2` still open them, and their best times, boards and medals carry over). The single-feature tracks are short ovals that an autopilot laps in ≤ 20 s with no respawn:

| Track | Checks |
|---|---|
| `test-flat` | grip, acceleration, top speed, hairpins |
| `test-ramp` | ramp jump and landing |
| `test-bank` | banked 180° turns |
| `test-surfaces` | asphalt → dirt → ice → grass strips, and dirt mid-way round the first hairpin |
| `test-turbo` | yellow and red turbo pads |
| `test-effects` | effect pads: no-steer, cruise, fragile, engine-off, slow-mo, then reset |
| `test-checkpoint` | four checkpoints in a row: split deltas, respawn at the last one |

Any other `assets/track/test*.json` joins the Test group; any other track joins the end of the campaign.

### Track themes

A track file may carry an optional `theme` block that changes its look without touching its layout: it is render-only, not part of the layout id (records carry over), and it works the same in spline tracks and `kit` tracks. Every field is optional; an absent field keeps the default stadium look, and a track with no `theme` renders exactly as before. Test tracks stay on the default. Format and validation: `src/track/theme.ts`; defaults: `src/render/theme.ts`.

```json
"theme": {
  "sky": "night",
  "skyLight": 0.6,
  "exposure": 0.9,
  "fog": "#141c33", "fogNear": 120, "fogFar": 700,
  "sun": "#9fb4ff", "sunIntensity": 0.7,
  "ground": "#3d5a6b",
  "curb": "#00c8ff",
  "sign": "#ff3df0",
  "screen": "#7a1fa8",
  "scenery": ["tree_default_dark", "rock_tallA"]
}
```

| Field | Default | What it changes |
|---|---|---|
| `sky` | `day` | Background and image-based light: `day`, `sunset`, `dusk`, `night` or `overcast` (Poly Haven CC0 HDRIs in `assets/sky/`) |
| `skyLight` | `0.45` | Strength of the light the sky casts |
| `exposure` | `1` | Tone-mapping exposure; below 1 darkens the whole frame |
| `fog`, `fogNear`, `fogFar` | `#b9d4e8`, 250, 1200 | Distance fog colour (match the sky's horizon) and its start / full distance in metres |
| `sun`, `sunIntensity` | `#fff4e0`, 2.2 | Sun colour and strength (shadows follow it) |
| `ground` | `#7fc25a` | Grass tint |
| `curb` | red | Curb stripe accent, alternating with white |
| `sign` | yellow | Turn-sign chevrons on the black boards; turbo signs keep their yellow / red |
| `screen` | navy blue | Arena screen background |
| `scenery` | six trees and rocks | Kenney Nature Kit models (`assets/nature-kit/<name>.glb`) the roadside scenery picks from; add a model's glb there to use it |

Colours are `#rrggbb`. An unknown key, a bad colour or an unknown sky fails validation, so a typo never silently does nothing.

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
- The small corner text (pose, fps, build label) is the debug overlay; backtick (`` ` ``) toggles it and `&debug=0` starts it hidden. The race HUD (timer, speed, LAP / CP, splits) is separate and always shown. `H` shows every key binding (also Esc → Controls).
- `&freeze=1` holds physics and the countdown and hides the Begin overlay, so the frame is stable. Add `&renderer=webgl2` in headless browsers (headless WebGPU renders blank).
- `&cam=top` swaps the chase camera for one straight above the track, framing the whole lap (fog off), e.g. `?track=test2&cam=top&freeze=1&renderer=webgl2`.
- `&cam=fly` opens the free-fly camera instead: the same `x&y&z&yaw` (plus `&pitch`, degrees, up positive) place the camera, not the car, e.g. `?track=test2&x=-60&y=40&z=-120&yaw=30&pitch=-25&cam=fly&freeze=1&renderer=webgl2`; `&orbit=1` starts a slow orbit of the whole track. In game, `C` toggles fly mode (race, ghost and audio hold still; `C` or `1`/`2`/`3` returns), WASD / arrows move, mouse drag looks, `E`/`Q` rise/sink, Shift is fast, `O` orbits. `P` while flying copies this fly-view URL.
- `make shots` (`npm run shots [-- test1 test-ramp]`, env `STEP=20`, `OUT=shots`; default: every Test-group track) starts a Vite dev server, walks each lap's centreline every `STEP` metres and writes `shots/<lap>/NNN.png` (gitignored). First run: `npx playwright install chromium-headless-shell`.

## Deploy

Every merge to `master` builds and deploys to https://bborbe.github.io/driftline/ via `.github/workflows/pages.yml` (GitHub Pages, source: GitHub Actions). The deployed commit SHA is in the page's `<meta name="commit">` tag.
