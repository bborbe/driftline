# Development

driftline is a Trackmania-like browser racing game. Vite + TypeScript + three.js (WebGPU, WebGL2 fallback).

```bash
make run        # dev server (installs deps if needed); drive: WASD / arrows, Space = handbrake; ?renderer=webgl2 forces WebGL2
make test       # fast test tier (seconds)
make test-all   # fast + slow tiers (minutes) — before merging physics/track changes
make build
```

See [`VISION.md`](../VISION.md) and [`AGENTS.md`](../AGENTS.md). Tracks, the track groups, the single-feature test tracks and track themes: [`tracks.md`](tracks.md). Building tracks from pieces: [`track-kit.md`](track-kit.md).

## Test tiers

`make test` runs the fast tier and `make test-all` runs the fast and slow tiers (vitest projects `fast` and `slow` in `vite.config.ts`; the slow tier is the `SLOW_TESTS` list, every file taking ≥ 2 s in CI). PR CI (`ci.yml`) runs fast only. The slow tier runs on every release tag (`release.yml`: fast + slow, build, GitHub release) and nightly on master (`nightly.yml`, which opens a `nightly-failure` issue when red; `gh workflow run nightly.yml -f inject_failure=true` tests that path). Run `make test-all` before merging physics or track changes. Release flow and tier rules: [`AGENTS.md`](../AGENTS.md) § Test tiers.

## Laps

A race is 1 lap by default. Pick 1–10 laps under **Laps** in the start-screen / Esc-menu settings (saved in localStorage), or pass `?laps=N` (e.g. `?track=test2&laps=3`), which overrides the saved setting. In a multi-lap race the HUD shows `LAP 1/3`, split deltas flash at every checkpoint and lap line, and the finish panel shows the total time plus each lap time with the best lap marked. Best time, splits and the top-10 board are kept separately per lap count (1-lap records keep their original keys); medals are single-lap only. The ghost replays the session's best single lap at the start of every lap. Backspace (or R) respawns at the current lap's last checkpoint; Delete restarts at lap 1.

## Online leaderboard

The game talks to the leaderboard server (`server/`) only when the build sets `VITE_LEADERBOARD_URL`; without it there is no Global tab and no network call. No credential ships in the game — the server trusts its Origin allow-list and validates every run:

```bash
cd server && make run                     # localhost:9090, allowed origin http://localhost:5173
VITE_LEADERBOARD_URL=http://localhost:9090/api/1.0 make run   # repo root
```

`src/leaderboard/client.ts` holds the name rule, the config and the two calls; `online.ts` wires them into a race. Each finished single-lap run the ghost recorder keeps (`GhostRecorder.onKeep`) is posted with its checkpoint ticks and `ghostPayload`, retried once, and never holds up the results card; an offline browser skips it with an "offline" note. The name is the Settings name, sanitised to the server's rule (A-Z 0-9 space _ . -, 1–12, no outer spaces); with none set, the first finish asks for it. The records panel's TOP 5 / GLOBAL tabs and the results card show the track's global top 10, the player's row highlighted. A track the server answers 404 for (no finish or no author medal, see `server/pkg/track/tracks.json`) and a multi-lap run show no global board.

## Cars

The player car is picked at build time from the registry in `src/render/cars.ts`:

```bash
VITE_CAR=stadium make build   # race (default) | stadium | raceFuture | box
```

An unknown id falls back to `box`. New entries must use CC0, CC-BY or MIT assets with their licence under `assets/LICENSES/`, and must never be Nadeo-derived.

**Livery.** Settings → *Livery*, *Colour* and *Race number* paint the car at once (saved in localStorage, `driftline-settings`): six code-drawn patterns (`solid`, `stripes`, `chevrons`, `two-tone`, `checker`, `flag`) on eight paints, with the number on the nose deck and both sides. The ghost always wears `ghostLivery()` of yours — the next pattern and the paint whose hue is furthest away, at least 90° (`src/render/car/livery.ts`). Painting (`src/render/car/paint.ts`) moves the body's paint triangles — saturated colormap texels on a Kenney glb, clearcoat materials on a code-built car — into a child mesh with UVs into a four-band atlas (top, left, right, ends); wheels, glass and trim keep their own materials.

**Car detail.** `src/render/car/detail.ts` adds code-built detail to every registry car: upper and lower suspension wishbones from the body to each wheel's inner pivot, a driver helmet with a dark visor at the entry's `cockpit` (helmet centre in the car frame, in `src/render/cars.ts`), and tread ribs plus a five-spoke hub under each wheel node, so they spin and steer with the wheel. Each frame `src/render/view.ts` passes the track surface to the car view, which reads every wheel's spring length from `wheelTravel()` (a read-only query in `src/physics/car.ts`, never called by `step()`), moves the wheel there and re-aims its wishbones at it; the ghost gets no surface and keeps the rest pose. Tread and spokes fade out with speed before they turn half a pitch per 60 fps frame (tread by 3.3 m/s, spokes by 13.2 m/s), so they never strobe. Detail objects carry `userData.carDetail`: the livery painter skips them, the ghost fades them like the rest of the car, and nothing of it enters physics or collision.

## Debug screenshots

- `?track=test2&x=-108&y=0.8&z=-59&yaw=90` spawns the car at that pose (yaw in degrees, 0 = +z, CCW positive). Without all four params the car spawns at the start line as usual. The HUD shows the current `yaw` in the same convention; press `P` to copy the current pose as a full `?track&x&y&z&yaw&freeze=1` URL (a toast confirms).
- The small corner text (pose, fps, build label) is the debug overlay. It is dev only: a plain URL hides it, `&dev=1` or `&debug=1` shows it (`&debug=0` always hides it), and backtick (`` ` ``) toggles it; add `&debug=1` to read the pose in a shot (`make shots` does). The race HUD (timer, speed, race-status panel, splits) is separate and always shown. `H` shows every key binding (also Esc → Controls).
- `&freeze=1` holds physics and the countdown and hides the Begin overlay, so the frame is stable. Add `&renderer=webgl2` in headless browsers (headless WebGPU renders blank).
- `&time=morning|noon|sunset|night|neon` and `&weather=sunny|cloudy|overcast|rain` pick the time of day and weather, each on its own (`neon` is Neon Night, never a random pick; `&refl=0|1` switches its road reflection, Settings → Graphics → Reflections); `&seed=<n>` replays a random pick (the debug line shows it as `random #<n>`). Without them a race uses the Settings *Time of day* and *Weather* choices — *Track default* (the track's `environment`), *Random* (a seeded pick) or one preset, each field on its own — which also switch the running race live (`src/track/environment.ts`, look in `src/render/environment.ts`, live apply in `src/menu/live.ts`). The URL params win at load only.
- `&quality=low|medium|high|auto` pins the graphics quality (Settings → Graphics; `src/render/quality.ts`): pass it on every shot or fps measurement, so Auto's probe and a stored Custom setup cannot change what you compare; `window.__driftlineQuality()` returns the quality, Auto's pick and the knobs in force.
- `&aa=0|1` switches FXAA (Settings → Graphics → Advanced → Anti-aliasing, off in every preset: the scene pass already has 4× MSAA; a value that differs from the quality's makes it Custom) and `&ao=1` turns on GTAO ambient occlusion (opt-in for its fps cost); `&bloom=0` drops the whole post pipeline (bloom, grade, FXAA) for A/B shots (`src/render/post.ts`).
- `&fps=<n>` caps the render rate (`0` uncapped, `120`, `60`, `30`; Settings → Graphics → Frame cap); physics stays at 100 Hz. Driven browsers use `&fps=30&quality=low` and a 960×540 viewport, and close their playwright session right after the shots (AGENTS.md § Always hold); fps measurements pass `&fps=0`. A `freeze=1` spawn is never throttled as an idle screen, so it measures at the cap.
- `&ghost=show` stands the ghost car 4 m to the car's left, in its pose and livery, with no best lap needed — for livery shots.
- `&cam=top` swaps the chase camera for one straight above the track, framing the whole lap (fog off), e.g. `?track=test2&cam=top&freeze=1&renderer=webgl2`.
- `&cam=fly` opens the free-fly camera instead: the same `x&y&z&yaw` (plus `&pitch`, degrees, up positive) place the camera, not the car, e.g. `?track=test2&x=-60&y=40&z=-120&yaw=30&pitch=-25&cam=fly&freeze=1&renderer=webgl2`; `&orbit=1` starts a slow orbit of the whole track. In game, `C` toggles fly mode (race, ghost and audio hold still; `C` or `1`/`2`/`3` returns), WASD / arrows move, mouse drag looks, `E`/`Q` rise/sink, Shift is fast, `O` orbits. `P` while flying copies this fly-view URL.
- `make shots` (`npm run shots [-- test1 test-ramp]`, env `STEP=20`, `OUT=shots`; default: every Test-group track) starts a Vite dev server, walks each lap's centreline every `STEP` metres and writes `shots/<lap>/NNN.png` (gitignored). First run: `npx playwright install chromium-headless-shell`.
- `scripts/live-drive.js` drives the car on the live site for shots of motion (sparks, dust, drift cue, checkpoint flash), which frozen poses cannot show: `playwright-cli -s=live-drive open --config=scripts/live-drive.config.json`, optionally `playwright-cli -s=live-drive goto '<base>?track=test-surfaces'` (default: test-checkpoint on the live site), then `playwright-cli -s=live-drive run-code --filename=scripts/live-drive.js`; close the session after. It steers at the centreline 12 m ahead under a 55 km/h cap and writes `shots/live-drive/<track>-NN-<state>.png` each time `CP n` or the surface label changes. Every drive is muted twice: the config launches Chrome with `--mute-audio` and the URL carries `vol=0`. Each step reads three elements (`#hud`, `.race-cp`, `.race-speed`) and then pauses ≥ 50 ms: a loop with no pause, or one polling `document.body.innerText`, starves the game's frame loop and the car crawls at a few km/h.

## Deploy

Every merge to `master` builds and deploys to https://bborbe.github.io/driftline/ via `.github/workflows/pages.yml` (GitHub Pages, source: GitHub Actions). The deployed commit SHA is in the page's `<meta name="commit">` tag.

Deploy concurrency: every `pages.yml` run (master push, PR preview, PR close) sits in one concurrency group `pages` with `cancel-in-progress: false`, so only one run deploys at a time — `actions/deploy-pages` allows one deployment per site — and a running deploy is never cut. GitHub keeps one pending run per group: a newer queued run replaces the older queued one, which then shows `cancelled`, often a master `push` run displaced by a preview. Nothing is lost by that, because the `plan` job reads master's live head (`gh api repos/<repo>/commits/master`), not `github.sha`, so the replacement builds and deploys the newer master as the root site (its run summary names the root SHA). Fork-PR runs deploy nothing and use their own group, so they never displace a deploy. `pages.yml` runs no tests — `ci.yml` tests every PR head and every master merge commit off the deploy path — so a run takes about a minute and a merge is live within two runs. To check a merge is live, read `<meta name="commit">` on the site, never the push run's status, and do not re-run a cancelled deploy by hand.
