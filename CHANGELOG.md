# Changelog

All notable changes to this project will be documented in this file.

Please choose versions by [Semantic Versioning](http://semver.org/).

* MAJOR version when you make incompatible API changes,
* MINOR version when you add functionality in a backwards-compatible manner, and
* PATCH version when you make backwards-compatible bug fixes.

Each release is a `vX.Y.Z` tag; `release.yml` runs the fast and slow test tiers and publishes the tag's section below as the GitHub release notes. Add changes under `## Unreleased`; a release renames it.

## Unreleased

- chore: the leaderboard server is no longer deployed — the online leaderboard is on hold, so its nuke-prod namespace and the `driftline.benjamin-borbe.de` vhost are torn down; `server/` and `server/k8s/` stay, `server/README.md` § Deploy says what a redeploy needs, and the Pages build no longer passes the leaderboard URL and token
- fix: wheels stand on the drawn asphalt instead of 0.1 m inside it — the road is drawn 0.1 m (curbs 0.2 m) over the physics surface, so the car view shortens each wheel's drawn spring by the drawn road height under it (`src/render/car/ground.ts`), and gives each spring back the body feel's lean and squat at its mount (`bodyLift`), so the rear wheels no longer dip 0.1 m under throttle; render-only, physics untouched

## v0.6.0

- feat: Trackmania key layout by default — `Backspace` (or `R`) respawns at the last checkpoint, `Delete` restarts the run; saved custom bindings are kept, and a key in Settings → Controls is cleared by right-click so `Delete` binds like any key
- feat: deploy the leaderboard server to the nuke-prod cluster — `server/k8s/` (StatefulSet with a 1Gi `/data` volume for the SQLite file, Service, Ingress routing only `/api/` for `driftline.benjamin-borbe.de`, token Secret from TeamVault), `cd server && BRANCH=master make buca` builds, pushes and applies; the Pages build reads `vars.VITE_LEADERBOARD_URL` and `secrets.VITE_LEADERBOARD_TOKEN`

## v0.5.0

- feat: leaderboard submit and list API on the server under `/api/1.0/` — `POST /runs` validates a lap (name, track, tick floor, ordered checkpoint splits, ghost ticks and lap time, 256 KiB cap) and keeps the best run per player per track, `GET /tracks/{track}/runs` lists the top N, `GET /runs/{id}/ghost` serves the stored ghost; every request needs the shared `X-Driftline-Token` and the allowed Origin (CORS preflight answered); the per-track checkpoint counts and floors are generated from the game's tracks (`src/leaderboard/server-tables.test.ts`), and the game's ghost encoder is exported as `ghostPayload`

## v0.4.0

- feat: leaderboard server skeleton in `server/` — a Go service (go-skeleton layout) with `/healthz` and `/readiness`, SQLite through the pure-Go `modernc.org/sqlite` with a `runs` table migration, env config (`DB_PATH`, `TOKEN`, `ALLOWED_ORIGIN`), a scratch Dockerfile and a `server` CI job running its Go tests; no submit / list API yet

## v0.3.2

- chore: Go tooling config for the coming leaderboard server (`server/`: golangci-lint, precommit targets, tool versions) and a root `.reviewignore` so the PR reviewer skips generated `go.sum` and counterfeiter mocks

## v0.3.1

- fix: ghost name tags no longer overhang the right screen edge by a fraction of a pixel, and no longer cover the volume slider or the debug readouts — a tag that would have to climb onto them hides instead

## v0.3.0

- feat: medal ghosts — gold and author pace ghosts (the autopilot lap, recorded in a worker and replayed time-scaled to the medal time) race alongside the personal-best ghost, each with a floating name tag showing its place, time and gap at the car's last checkpoint; pick them in Settings → Race → Ghosts or `?ghosts=pb,gold,author`

## v0.2.1

- fix: the gamepad press that wakes the pad now counts — browsers reveal a pad only on its first button press after each page load, and that press (A on Begin after a track pick, the first d-pad step) was swallowed; the H panel says to press any button, then reload, when no "Controller connected" toast shows

## v0.2.0

- chore: opt into the maintainer bots (`.maintainer.yaml`: auto-approve, auto-release, trivial auto-merge); `release.yml` takes the version from the tag instead of requiring it to equal `package.json`
- feat: shareable challenge links — Results → Challenge a friend copies a URL with the target time and the session's best-lap ghost (lossless, ≤ 8192 chars, else target only); opening it races that ghost under the sender's Settings name, and a bad link says why over the start menu

## v0.1.0

- feat: split tests into a fast tier (every PR, `make test`) and a slow tier (releases, nightly on master, `make test-all`)
- feat: release workflow on `v*` tags and a nightly slow run on master that opens a `nightly-failure` issue when red
